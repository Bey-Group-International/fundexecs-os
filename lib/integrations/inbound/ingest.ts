// lib/integrations/inbound/ingest.ts
// Persistence for verified inbound webhook events: claim → thread → message →
// finalize. The claim is an ingest_log insert protected by the unique
// (org, channel, external_id) index, so a provider retry of the same delivery
// conflicts there and is acknowledged without touching the inbox — the same
// claim-first idempotency shape as lib/gift-earn. The Supabase client is
// injected (service-role at the route) so the writer is unit-testable.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { computePriority } from "@/lib/inbox/intelligence";
import { recordThreadOnTimeline } from "@/lib/inbox/crm-activity.server";
import type { InboundEvent } from "./types";

const UNIQUE_VIOLATION = "23505";

export type IngestResult =
  | { ok: true; duplicate: true }
  | { ok: true; duplicate: false; threadId: string; created: boolean }
  | { ok: false; error: string };

/**
 * Ingest one verified inbound event for an org. Returns duplicate:true (a
 * success — the provider's retry is satisfied) when this delivery was already
 * claimed. A write failure after the claim finalizes the log row with the
 * error, so the inbound ledger records the miss instead of losing it.
 */
export async function ingestInboundEvent(
  supabase: SupabaseClient<Database>,
  orgId: string,
  webhookChannel: string,
  event: InboundEvent,
): Promise<IngestResult> {
  // 1. Claim the delivery. A conflict means we already ingested it.
  const claim = await supabase
    .from("ingest_log")
    .insert({
      organization_id: orgId,
      channel: webhookChannel,
      event_type: event.eventType,
      external_id: event.eventId,
      ok: true,
      detail: "claimed",
    })
    .select("id")
    .single();

  if (claim.error) {
    if (claim.error.code === UNIQUE_VIOLATION) return { ok: true, duplicate: true };
    return { ok: false, error: claim.error.message };
  }
  const logId = claim.data.id;

  const finalize = async (fields: { ok: boolean; detail: string; thread_id?: string }) => {
    await supabase.from("ingest_log").update(fields).eq("id", logId);
  };

  try {
    const seed = event.thread;
    const preview = event.message.body.replace(/\s+/g, " ").trim().slice(0, 200);
    const occurredAt = event.message.occurredAt ?? new Date().toISOString();

    // 2. Find-or-create the thread by its provider correlation key.
    const existing = await supabase
      .from("inbox_threads")
      .select("id")
      .eq("organization_id", orgId)
      .eq("channel", seed.channel)
      .eq("external_id", seed.threadKey)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    let threadId: string;
    const created = !existing.data;

    if (existing.data) {
      threadId = existing.data.id;
      // New activity reopens and re-flags the thread; meeting fields are only
      // touched when the event speaks to them (undefined = leave as-is,
      // null = explicitly cleared, e.g. a cancellation).
      const update: Database["public"]["Tables"]["inbox_threads"]["Update"] = {
        preview,
        last_message_at: occurredAt,
        unread: true,
        status: "open",
      };
      if (seed.meetingAt !== undefined) update.meeting_at = seed.meetingAt;
      if (seed.meetingUrl !== undefined) update.meeting_url = seed.meetingUrl;
      const updated = await supabase.from("inbox_threads").update(update).eq("id", threadId);
      if (updated.error) throw new Error(updated.error.message);
    } else {
      const inserted = await supabase
        .from("inbox_threads")
        .insert({
          organization_id: orgId,
          channel: seed.channel,
          category: seed.category,
          subject: seed.subject,
          counterparty_name: seed.counterpartyName,
          counterparty_email: seed.counterpartyEmail,
          preview,
          unread: true,
          priority: computePriority({
            category: seed.category,
            unread: true,
            hasContext: false,
            ageHours: 0,
            intent: null,
          }),
          last_message_at: occurredAt,
          meeting_at: seed.meetingAt ?? null,
          meeting_url: seed.meetingUrl ?? null,
          external_id: seed.threadKey,
        })
        .select("id")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      threadId = inserted.data.id;
    }

    // 3. Append the message.
    const message = await supabase.from("inbox_messages").insert({
      organization_id: orgId,
      thread_id: threadId,
      direction: "inbound",
      author: event.message.author,
      body: event.message.body,
      occurred_at: occurredAt,
      metadata: (event.message.metadata ?? {}) as Json,
    });
    if (message.error) throw new Error(message.error.message);

    // 4. The conversation on the CRM record of whoever is on the other end.
    //
    // On every ingest, not only on the first: the row is meant to stay current,
    // so the newest summary and the latest message time reach the record rather
    // than the state the conversation was in when it started. Upserted on the
    // thread, so a fortieth reply updates one entry instead of adding a fortieth.
    //
    // Never throws and its result is not read. This is a webhook path — a thread
    // that cannot reach the CRM must still reach the inbox, or the provider
    // retries the delivery and the operator loses the message.
    await recordThreadOnTimeline(supabase as never, {
      orgId,
      actorId: null,
      now: occurredAt,
      thread: {
        id: threadId,
        channel: seed.channel,
        subject: seed.subject,
        counterpartyEmail: seed.counterpartyEmail,
        // Written by the intelligence pass later, so absent on a first ingest.
        aiSummary: null,
        preview,
        lastMessageAt: occurredAt,
      },
    });

    // 5. Finalize the ledger row with where the event landed.
    await finalize({
      ok: true,
      detail: created ? "created thread" : "appended to thread",
      thread_id: threadId,
    });
    return { ok: true, duplicate: false, threadId, created };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "ingest failed";
    await finalize({ ok: false, detail });
    return { ok: false, error: detail };
  }
}
