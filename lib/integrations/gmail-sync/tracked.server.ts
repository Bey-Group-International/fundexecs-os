// lib/integrations/gmail-sync/tracked.server.ts
// Replies to the threads the app started from a member's own mailbox.
//
// A host's meeting follow-up goes out from their personal Gmail when they have
// connected it, so the replies land there — a mailbox the org sweep
// (./sync.server.ts) never reads. Reading a member's whole mailbox is not
// something anybody asked for, so this does not: it reads ONLY the Gmail
// threads recorded in tracked_mail_threads (written by the follow-up send,
// lib/meetings/follow-up-threads.server.ts), and each of those expires after
// 30 days.
//
// Each new message goes through the same mapGmailMessage → ingestInboundEvent
// path as everything else, keyed the same way, so a reply lands on the inbox
// thread the follow-up created and is linked to its meeting. The follow-up
// itself carries X-FundExecs-Origin and is skipped — it is already recorded.
//
// Needs gmail.readonly on the member's own grant (GOOGLE_CALENDAR_SCOPES). A
// grant made before that scope was requested is recorded on the row
// ("reconnect Google") and retried no sooner than a day later.
//
// Never throws; bounded per sweep.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { accessTokenFor, type ConnectionRow } from "@/lib/calendar/google.server";
import { GMAIL_READ_SCOPE, googleOAuthConfigured } from "@/lib/google-oauth";
import { ingestInboundEvent } from "@/lib/integrations/inbound/ingest";
import { mapGmailMessage, type GmailMessage } from "@/lib/integrations/gmail-sync/map";
import { gmail, GmailError, type FetchLike } from "@/lib/integrations/gmail-sync/sync.server";

type Client = SupabaseClient<Database>;

/** The ingest_log channel member-mailbox messages are claimed under. */
export const TRACKED_CHANNEL = "gmail_member_sync";
export const MAX_THREADS = 100;
/** A thread checked more recently than this waits for the next sweep. */
export const RECHECK_MS = 30 * 60 * 1000;
/** A grant without the read scope is retried this often, not every sweep. */
export const MISSING_SCOPE_RETRY_MS = 24 * 60 * 60 * 1000;
export const MISSING_SCOPE_ERROR = "Reconnect Google to let replies to your follow-ups reach the inbox.";

export interface TrackedSweepSummary {
  threads: number;
  ingested: number;
  needsReconnect: number;
  failed: number;
}

/** Whether a member's grant can read mail. */
export function grantCanRead(grantedScope: string | null | undefined): boolean {
  return Boolean(grantedScope?.split(/\s+/).includes(GMAIL_READ_SCOPE));
}

/** Whether a tracked thread is due a check. */
export function isTrackedThreadDue(
  row: { last_checked_at: string | null; last_error: string | null },
  now: Date,
): boolean {
  if (!row.last_checked_at) return true;
  const last = Date.parse(row.last_checked_at);
  if (Number.isNaN(last)) return true;
  const wait = row.last_error === MISSING_SCOPE_ERROR ? MISSING_SCOPE_RETRY_MS : RECHECK_MS;
  return now.getTime() - last >= wait;
}

type TrackedRow = Database["public"]["Tables"]["tracked_mail_threads"]["Row"];
type MemberConnection = ConnectionRow & { granted_scope: string | null };

export async function syncTrackedThreads(
  client: Client,
  opts: { now?: Date; limit?: number; fetchImpl?: FetchLike; tokenFor?: (conn: MemberConnection) => Promise<string | null> } = {},
): Promise<TrackedSweepSummary> {
  const summary: TrackedSweepSummary = { threads: 0, ingested: 0, needsReconnect: 0, failed: 0 };
  if (!googleOAuthConfigured() && !opts.tokenFor) return summary;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const limit = opts.limit ?? MAX_THREADS;

  // Past their 30 days: stop reading them, and stop holding the reference.
  await client.from("tracked_mail_threads").delete().lte("expires_at", nowIso);

  const { data: rows, error } = await client
    .from("tracked_mail_threads")
    .select("id, organization_id, user_id, gmail_thread_id, inbox_thread_id, meeting_id, mailbox_email, last_checked_at, last_error, expires_at, created_at")
    .gt("expires_at", nowIso)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    // Over-fetched: the due check below is the real filter.
    .limit(limit * 3);
  if (error) {
    console.error("[gmail-tracked] query failed", error.message);
    return summary;
  }
  const due = ((rows ?? []) as TrackedRow[]).filter((r) => isTrackedThreadDue(r, now)).slice(0, limit);
  if (due.length === 0) return summary;

  const userIds = [...new Set(due.map((r) => r.user_id))];
  const { data: conns } = await client
    .from("google_calendar_connections")
    .select("id, user_id, organization_id, google_email, refresh_ciphertext, refresh_iv, refresh_auth_tag, last_sync_at, last_error, consecutive_failures, next_attempt_at, granted_scope")
    .in("user_id", userIds);
  const connByUser = new Map(((conns ?? []) as unknown as MemberConnection[]).map((c) => [c.user_id, c]));

  const tokenFor =
    opts.tokenFor ??
    (async (conn: MemberConnection) => {
      const t = await accessTokenFor(conn, { reuse: true });
      return t.ok && t.data ? t.data : null;
    });
  const tokens = new Map<string, string | null>();

  const mark = (id: string, fields: Partial<TrackedRow>) =>
    client.from("tracked_mail_threads").update({ last_checked_at: nowIso, ...fields }).eq("id", id);

  for (const row of due) {
    summary.threads++;
    const conn = connByUser.get(row.user_id);
    if (!conn || !grantCanRead(conn.granted_scope)) {
      summary.needsReconnect++;
      await mark(row.id, { last_error: MISSING_SCOPE_ERROR });
      continue;
    }
    if (!tokens.has(row.user_id)) tokens.set(row.user_id, await tokenFor(conn));
    const token = tokens.get(row.user_id);
    if (!token) {
      summary.needsReconnect++;
      await mark(row.id, { last_error: MISSING_SCOPE_ERROR });
      continue;
    }

    try {
      const thread = await gmail<{ messages?: GmailMessage[] }>(
        fetchImpl,
        token,
        `/threads/${encodeURIComponent(row.gmail_thread_id)}?format=full`,
      );
      const messages = (thread.messages ?? []).filter((m): m is GmailMessage & { id: string } => Boolean(m.id));
      const keys = messages.map((m) => `gmail:${row.user_id}:${m.id}`);
      const { data: seen } = keys.length
        ? await client
            .from("ingest_log")
            .select("external_id")
            .eq("organization_id", row.organization_id)
            .eq("channel", TRACKED_CHANNEL)
            .in("external_id", keys)
        : { data: [] as Array<{ external_id: string }> };
      const done = new Set((seen ?? []).map((r) => r.external_id));
      const mailbox = conn.google_email ?? row.mailbox_email ?? "";

      for (const message of messages) {
        const key = `gmail:${row.user_id}:${message.id}`;
        if (done.has(key)) continue;
        const mapped = mapGmailMessage(message, mailbox);
        if (!mapped.ok) {
          await client.from("ingest_log").insert({
            organization_id: row.organization_id,
            channel: TRACKED_CHANNEL,
            event_type: "gmail.skipped",
            external_id: key,
            ok: true,
            detail: `skipped: ${mapped.reason}`,
          });
          continue;
        }
        const event = {
          ...mapped.event,
          eventId: key,
          thread: { ...mapped.event.thread, ...(row.meeting_id ? { meetingId: row.meeting_id } : {}) },
        };
        const result = await ingestInboundEvent(client, row.organization_id, TRACKED_CHANNEL, event);
        if (result.ok && !result.duplicate) summary.ingested++;
      }
      await mark(row.id, { last_error: null });
    } catch (err) {
      if (err instanceof GmailError && err.status === 404) {
        // Deleted from the mailbox: nothing left to read.
        await client.from("tracked_mail_threads").delete().eq("id", row.id);
        continue;
      }
      const reconnect = err instanceof GmailError && (err.status === 401 || err.status === 403);
      if (reconnect) summary.needsReconnect++;
      else summary.failed++;
      await mark(row.id, {
        last_error: reconnect ? MISSING_SCOPE_ERROR : (err instanceof Error ? err.message : "check failed").slice(0, 500),
      });
    }
  }

  return summary;
}
