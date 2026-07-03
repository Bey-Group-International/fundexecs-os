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
}

function makeSupabase(opts: {
  existingThreadId?: string | null;
  claimConflict?: boolean;
  existingClaim?: { id: string; ok: boolean } | null;
  failMessageInsert?: boolean;
} = {}): { supabase: SupabaseClient<Database>; recorded: Recorded } {
  const recorded: Recorded = { inserts: [], updates: [] };

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
        if (table === "ingest_log") {
          return { data: opts.existingClaim ?? { id: "log-1", ok: true }, error: null };
        }
        return {
          data: opts.existingThreadId ? { id: opts.existingThreadId } : null,
          error: null,
        };
      };
      const chain = { eq: () => chain, maybeSingle };
      return chain;
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

  it("retries a previously failed claim instead of acknowledging it as a duplicate", async () => {
    const { supabase, recorded } = makeSupabase({
      claimConflict: true,
      existingClaim: { id: "log-failed", ok: false },
      existingThreadId: "thr-1",
    });
    const result = await ingestInboundEvent(supabase, "org-1", "calendly", BOOKING_EVENT);
    expect(result).toEqual({ ok: true, duplicate: false, threadId: "thr-1", created: false });

    expect(recorded.inserts.some((i) => i.table === "inbox_messages")).toBe(true);
    const finalized = recorded.updates.find((u) => u.table === "ingest_log")!;
    expect(finalized.id).toBe("log-failed");
    expect(finalized.patch).toMatchObject({
      ok: true,
      detail: "appended to thread",
      thread_id: "thr-1",
    });
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
});
