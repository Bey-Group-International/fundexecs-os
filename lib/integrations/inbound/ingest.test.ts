// Coverage for the inbound ingest writer (audit P1 #15). The claim-first shape
// is the contract under test: a duplicate delivery must be acknowledged without
// touching the inbox, a first delivery must create the thread with a real
// triage priority, a follow-up must append and re-flag the existing thread
// (only touching meeting fields the event speaks to), and a write failure
// after the claim must finalize the ledger row as a recorded miss.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { ingestInboundEvent } from "./ingest";
import type { InboundEvent } from "./types";

interface Recorded {
  inserts: { table: string; row: Record<string, unknown> }[];
  updates: { table: string; patch: Record<string, unknown>; id: unknown }[];
  upserts: { table: string; rows: Record<string, unknown>[]; onConflict: string }[];
}

function makeSupabase(opts: {
  existingThreadId?: string | null;
  claimConflict?: boolean;
  failMessageInsert?: boolean;
  /** A contact in the CRM holding the counterparty's address, if there is one. */
  crmContactId?: string;
  /** Make the CRM write blow up, to prove the ingest does not go with it. */
  failCrmWrite?: boolean;
} = {}): { supabase: SupabaseClient<Database>; recorded: Recorded } {
  const recorded: Recorded = { inserts: [], updates: [], upserts: [] };

  const from = (table: string) => ({
    insert(row: Record<string, unknown>) {
      recorded.inserts.push({ table, row });
      return {
        select: () => ({
          single: async () => {
            if (table === "ingest_log" && opts.claimConflict) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            return { data: { id: table === "inbox_threads" ? "thr-new" : "log-1" }, error: null };
          },
        }),
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve(
            table === "inbox_messages" && opts.failMessageInsert
              ? { error: { message: "message insert failed" } }
              : { error: null },
          ).then(onFulfilled),
      };
    },
    update(patch: Record<string, unknown>) {
      const record = { table, patch, id: undefined as unknown };
      recorded.updates.push(record);
      return {
        eq: (_col: string, id: unknown) => {
          record.id = id;
          return Promise.resolve({ error: null });
        },
      };
    },
    select() {
      const maybeSingle = async () => {
        // The CRM step looks up whether the counterparty is a contact; the thread
        // lookup asks whether this conversation already exists. Different tables,
        // different answers.
        if (table === "network_contacts") {
          return { data: opts.crmContactId ? { id: opts.crmContactId } : null, error: null };
        }
        return { data: opts.existingThreadId ? { id: opts.existingThreadId } : null, error: null };
      };
      const chain: Record<string, unknown> = { eq: () => chain, limit: () => chain, maybeSingle };
      return chain;
    },
    upsert(rows: Record<string, unknown>[], options: { onConflict: string }) {
      recorded.upserts.push({ table, rows, onConflict: options.onConflict });
      return Promise.resolve(
        opts.failCrmWrite ? { error: { message: "timeline write failed" } } : { error: null },
      );
    },
  });

  return { supabase: { from } as unknown as SupabaseClient<Database>, recorded };
}

const BOOKING_EVENT: InboundEvent = {
  eventType: "invitee.created",
  eventId: "inv-1:invitee.created",
  thread: {
    channel: "calendly",
    category: "booking",
    subject: "Booking: Intro call",
    counterpartyName: "Dana LP",
    counterpartyEmail: "dana@lp.test",
    threadKey: "https://api.calendly.com/scheduled_events/ev-1",
    meetingAt: "2026-07-10T15:00:00Z",
    meetingUrl: "https://zoom.us/j/123",
  },
  message: {
    author: "Dana LP",
    body: 'Dana LP booked "Intro call" for Fri, 10 Jul 2026 15:00:00 GMT.',
    occurredAt: "2026-07-03T10:00:00Z",
    metadata: { via: "calendly" },
  },
};

describe("ingestInboundEvent", () => {
  it("acknowledges a duplicate delivery without touching the inbox", async () => {
    const { supabase, recorded } = makeSupabase({ claimConflict: true });
    const result = await ingestInboundEvent(supabase, "org-1", "calendly", BOOKING_EVENT);
    expect(result).toEqual({ ok: true, duplicate: true });
    expect(recorded.inserts.filter((i) => i.table !== "ingest_log")).toHaveLength(0);
    expect(recorded.updates).toHaveLength(0);
  });

  it("creates a thread with triage priority on first delivery and finalizes the ledger", async () => {
    const { supabase, recorded } = makeSupabase();
    const result = await ingestInboundEvent(supabase, "org-1", "calendly", BOOKING_EVENT);
    expect(result).toEqual({ ok: true, duplicate: false, threadId: "thr-new", created: true });

    const thread = recorded.inserts.find((i) => i.table === "inbox_threads")!.row;
    expect(thread.external_id).toBe(BOOKING_EVENT.thread.threadKey);
    expect(thread.unread).toBe(true);
    expect(thread.meeting_at).toBe("2026-07-10T15:00:00Z");
    // A fresh unread booking scores well above zero — the thread must enter
    // the triage queue, not sit at the default-0 bottom.
    expect(thread.priority as number).toBeGreaterThanOrEqual(50);

    const message = recorded.inserts.find((i) => i.table === "inbox_messages")!.row;
    expect(message.direction).toBe("inbound");
    expect(message.thread_id).toBe("thr-new");
    expect(message.metadata).toMatchObject({ via: "calendly" });

    const finalized = recorded.updates.find((u) => u.table === "ingest_log")!;
    expect(finalized.id).toBe("log-1");
    expect(finalized.patch).toMatchObject({ ok: true, thread_id: "thr-new" });
  });

  it("appends to the existing thread, re-flagging it and honoring explicit meeting clears", async () => {
    const { supabase, recorded } = makeSupabase({ existingThreadId: "thr-1" });
    const cancelEvent: InboundEvent = {
      ...BOOKING_EVENT,
      eventType: "invitee.canceled",
      eventId: "inv-1:invitee.canceled",
      thread: { ...BOOKING_EVENT.thread, meetingAt: null, meetingUrl: null },
      message: { ...BOOKING_EVENT.message, body: "Dana LP canceled the booking." },
    };
    const result = await ingestInboundEvent(supabase, "org-1", "calendly", cancelEvent);
    expect(result).toEqual({ ok: true, duplicate: false, threadId: "thr-1", created: false });

    expect(recorded.inserts.some((i) => i.table === "inbox_threads")).toBe(false);
    const threadUpdate = recorded.updates.find((u) => u.table === "inbox_threads")!;
    expect(threadUpdate.id).toBe("thr-1");
    expect(threadUpdate.patch).toMatchObject({
      unread: true,
      status: "open",
      meeting_at: null,
      meeting_url: null,
    });
  });

  it("records a message the org sent as outbound, without re-flagging its thread", async () => {
    const { supabase, recorded } = makeSupabase({ existingThreadId: "thr-1" });
    const sent: InboundEvent = {
      ...BOOKING_EVENT,
      eventId: "gmail:msg-9",
      message: { ...BOOKING_EVENT.message, body: "Sending the deck.", direction: "outbound" },
    };
    await ingestInboundEvent(supabase, "org-1", "gmail_sync", sent);

    const threadUpdate = recorded.updates.find((u) => u.table === "inbox_threads")!;
    expect(threadUpdate.patch).not.toHaveProperty("unread");
    expect(threadUpdate.patch).not.toHaveProperty("status");
    const message = recorded.inserts.find((i) => i.table === "inbox_messages")!;
    expect(message.row.direction).toBe("outbound");
  });

  it("creates a thread the org started as read", async () => {
    const { supabase, recorded } = makeSupabase();
    await ingestInboundEvent(supabase, "org-1", "gmail_sync", {
      ...BOOKING_EVENT,
      eventId: "gmail:msg-10",
      message: { ...BOOKING_EVENT.message, direction: "outbound" },
    });
    const thread = recorded.inserts.find((i) => i.table === "inbox_threads")!;
    expect(thread.row.unread).toBe(false);
  });

  it("leaves meeting fields alone when the event does not speak to them", async () => {
    const { supabase, recorded } = makeSupabase({ existingThreadId: "thr-1" });
    const emailEvent: InboundEvent = {
      eventType: "email.received",
      eventId: "em-2",
      thread: {
        channel: "gmail",
        category: "messaging",
        subject: "Q3 Update",
        counterpartyName: "Dana LP",
        counterpartyEmail: "dana@lp.test",
        threadKey: "email:dana@lp.test:q3 update",
      },
      message: { author: "Dana LP", body: "Any news?", metadata: { via: "resend" } },
    };
    await ingestInboundEvent(supabase, "org-1", "resend", emailEvent);
    const threadUpdate = recorded.updates.find((u) => u.table === "inbox_threads")!;
    expect("meeting_at" in threadUpdate.patch).toBe(false);
    expect("meeting_url" in threadUpdate.patch).toBe(false);
  });

  it("finalizes the ledger row as a recorded miss when a write fails after the claim", async () => {
    const { supabase, recorded } = makeSupabase({ failMessageInsert: true });
    const result = await ingestInboundEvent(supabase, "org-1", "calendly", BOOKING_EVENT);
    expect(result).toEqual({ ok: false, error: "message insert failed" });

    const finalized = recorded.updates.find((u) => u.table === "ingest_log")!;
    expect(finalized.patch).toMatchObject({ ok: false, detail: "message insert failed" });
  });
  /**
   * The CRM half of an ingest, from the ingest's side.
   *
   * crm-activity.server.test.ts covers the writer. What only this test can show
   * is that the ingest hands it the thread it just wrote — the id, the channel and
   * the address it resolved — rather than something stale or something else.
   */
  it("puts the conversation on the CRM record of a counterparty it knows", async () => {
    const { supabase, recorded } = makeSupabase({ crmContactId: "contact-dana" });
    const result = await ingestInboundEvent(supabase, "org-1", "calendly", BOOKING_EVENT);
    expect(result).toEqual({ ok: true, duplicate: false, threadId: "thr-new", created: true });

    const timeline = recorded.upserts.find((u) => u.table === "network_activities")!;
    expect(timeline.rows).toHaveLength(1);
    const row = timeline.rows[0];
    expect(row.organization_id).toBe("org-1");
    expect(row.contact_id).toBe("contact-dana");
    expect(row.is_system).toBe(true);
    // The thread this ingest wrote, so a reply updates that entry instead of
    // adding another copy of the conversation.
    expect((row.metadata as { thread_id: string }).thread_id).toBe("thr-new");
    expect(row.occurred_at).toBe(BOOKING_EVENT.message.occurredAt);
  });

  it("writes no timeline entry for a counterparty the CRM does not hold", async () => {
    const { supabase, recorded } = makeSupabase();
    await ingestInboundEvent(supabase, "org-1", "calendly", BOOKING_EVENT);
    expect(recorded.upserts).toHaveLength(0);
  });

  /**
   * The property that matters more than the feature.
   *
   * This is a webhook path: an ingest that reports failure is a delivery the
   * provider retries and, once it gives up, a message the operator never sees. A
   * CRM timeline entry is not worth that, so a CRM failure must leave the ingest
   * succeeding and the ledger row saying the thread landed.
   */
  it("still acknowledges the delivery when the CRM write fails", async () => {
    const { supabase, recorded } = makeSupabase({ crmContactId: "contact-dana", failCrmWrite: true });
    const result = await ingestInboundEvent(supabase, "org-1", "calendly", BOOKING_EVENT);
    expect(result).toEqual({ ok: true, duplicate: false, threadId: "thr-new", created: true });

    const finalized = recorded.updates.find((u) => u.table === "ingest_log")!;
    expect(finalized.patch).toMatchObject({ ok: true, thread_id: "thr-new" });
  });
});
