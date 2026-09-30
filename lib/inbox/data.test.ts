// Coverage for refreshThreadSummary: the AI-summary cache writer. It loads a
// thread + its recent messages, summarizes (injected here — no network), and
// persists ai_summary + intent while re-scoring priority with the detected
// intent. The contract under test: it writes the summarizer's output, folds an
// urgent intent into a higher priority, no-ops when the thread or its messages
// are missing, and never throws (best-effort, so it can't break ingest).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { refreshThreadSummary } from "./data";

type ThreadRow = {
  subject: string;
  channel: string;
  category: string;
  counterparty_name: string | null;
  counterparty_email: string | null;
  deal_id: string | null;
  investor_id: string | null;
  unread: boolean;
  last_message_at: string | null;
};
type MessageRow = { direction: string; author: string | null; body: string };

interface Recorded {
  updates: { patch: Record<string, unknown> }[];
  upserts: { table: string; rows: Record<string, unknown>[]; onConflict: string }[];
}

function makeSupabase(opts: {
  thread?: ThreadRow | null;
  messages?: MessageRow[];
  threadError?: boolean;
  /** A CRM contact holding the counterparty's address, if there is one. */
  crmContactId?: string;
}): { supabase: SupabaseClient<Database>; recorded: Recorded } {
  const recorded: Recorded = { updates: [], upserts: [] };

  const from = (table: string) => {
    if (table === "network_contacts") {
      // .select().eq().eq().limit().maybeSingle() → the contact, or nobody.
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({
          data: opts.crmContactId ? { id: opts.crmContactId } : null,
          error: null,
        }),
      };
      return chain;
    }
    if (table === "network_activities") {
      return {
        upsert: async (rows: Record<string, unknown>[], options: { onConflict: string }) => {
          recorded.upserts.push({ table, rows, onConflict: options.onConflict });
          return { error: null };
        },
      };
    }
    if (table === "inbox_messages") {
      // .select().eq().eq().order().limit() → resolves to the message rows.
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: opts.messages ?? [], error: null }),
      };
      return chain;
    }
    // inbox_threads: .select().eq().eq().maybeSingle() for the read,
    // .update().eq().eq() for the write.
    return {
      select: () => {
        const chain = {
          eq: () => chain,
          maybeSingle: async () =>
            opts.threadError
              ? { data: null, error: { message: "boom" } }
              : { data: opts.thread ?? null, error: null },
        };
        return chain;
      },
      update: (patch: Record<string, unknown>) => {
        recorded.updates.push({ patch });
        const chain = { eq: () => chain, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
        return chain;
      },
    };
  };

  return { supabase: { from } as unknown as SupabaseClient<Database>, recorded };
}

const baseThread: ThreadRow = {
  subject: "Series A term sheet",
  channel: "gmail",
  category: "messaging",
  counterparty_name: "Dana Ito",
  counterparty_email: "dana@fund.com",
  deal_id: null,
  investor_id: null,
  unread: true,
  last_message_at: "2026-07-10T00:00:00.000Z",
};

const at = (iso: string) => () => new Date(iso);

describe("refreshThreadSummary", () => {
  it("persists the summarizer's summary + intent", async () => {
    const { supabase, recorded } = makeSupabase({
      thread: baseThread,
      messages: [{ direction: "inbound", author: "Dana", body: "Can you review the deck?" }],
    });
    const summarize = jest.fn().mockResolvedValue({ summary: "Dana wants the deck reviewed.", intent: "Requesting review" });

    await refreshThreadSummary(supabase, "org-1", "thr-1", { summarize, now: at("2026-07-10T01:00:00.000Z") });

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0].patch).toMatchObject({
      ai_summary: "Dana wants the deck reviewed.",
      intent: "Requesting review",
    });
  });

  it("passes the thread + messages through as the digest input", async () => {
    const { supabase } = makeSupabase({
      thread: baseThread,
      messages: [
        { direction: "inbound", author: "Dana", body: "First" },
        { direction: "outbound", author: "Me", body: "Second" },
      ],
    });
    const summarize = jest.fn().mockResolvedValue({ summary: "s", intent: "i" });

    await refreshThreadSummary(supabase, "org-1", "thr-1", { summarize });

    expect(summarize).toHaveBeenCalledWith({
      subject: "Series A term sheet",
      category: "messaging",
      counterparty: "Dana Ito",
      messages: [
        { direction: "inbound", author: "Dana", body: "First" },
        { direction: "outbound", author: "Me", body: "Second" },
      ],
    });
  });

  it("folds an urgent detected intent into a higher priority than a bland one", async () => {
    const run = async (intent: string) => {
      const { supabase, recorded } = makeSupabase({
        thread: baseThread,
        messages: [{ direction: "inbound", author: "Dana", body: "..." }],
      });
      await refreshThreadSummary(supabase, "org-1", "thr-1", {
        summarize: async () => ({ summary: "s", intent }),
        now: at("2026-07-10T00:30:00.000Z"),
      });
      return recorded.updates[0].patch.priority as number;
    };

    const urgent = await run("Wire the funds today");
    const bland = await run("Just saying hi");
    expect(urgent).toBeGreaterThan(bland);
  });

  it("no-ops (no write) when the thread has no messages yet", async () => {
    const { supabase, recorded } = makeSupabase({ thread: baseThread, messages: [] });
    const summarize = jest.fn();

    await refreshThreadSummary(supabase, "org-1", "thr-1", { summarize });

    expect(summarize).not.toHaveBeenCalled();
    expect(recorded.updates).toHaveLength(0);
  });

  it("no-ops when the thread is missing", async () => {
    const { supabase, recorded } = makeSupabase({ thread: null, messages: [] });
    await refreshThreadSummary(supabase, "org-1", "missing", { summarize: async () => ({ summary: "s", intent: "i" }) });
    expect(recorded.updates).toHaveLength(0);
  });

  it("never throws when the summarizer fails (best-effort)", async () => {
    const { supabase, recorded } = makeSupabase({
      thread: baseThread,
      messages: [{ direction: "inbound", author: "Dana", body: "hi" }],
    });
    await expect(
      refreshThreadSummary(supabase, "org-1", "thr-1", {
        summarize: async () => {
          throw new Error("model down");
        },
      }),
    ).resolves.toBeUndefined();
    expect(recorded.updates).toHaveLength(0);
  });
  /**
   * Why the CRM entry is rewritten here rather than only at ingest.
   *
   * The ingest writes the entry before this runs, so it can only carry the raw
   * preview — "Hi, could you send over…". Once a summary exists, the record should
   * say what the conversation was about. The upsert key makes that a correction to
   * the same entry rather than a second copy of the conversation, which is the
   * whole reason the key exists.
   */
  it("puts the fresh summary on the counterparty's CRM record", async () => {
    const { supabase, recorded } = makeSupabase({
      thread: baseThread,
      messages: [{ direction: "inbound", author: "Dana", body: "Can you review the deck?" }],
      crmContactId: "contact-dana",
    });
    const summarize = jest.fn().mockResolvedValue({
      summary: "Dana wants the deck reviewed.",
      intent: "Requesting review",
    });

    await refreshThreadSummary(supabase, "org-1", "thr-1", { summarize });

    expect(recorded.upserts).toHaveLength(1);
    const row = recorded.upserts[0].rows[0];
    expect(row.contact_id).toBe("contact-dana");
    expect(row.body).toBe("Dana wants the deck reviewed.");
    expect((row.metadata as { thread_id: string }).thread_id).toBe("thr-1");
    // The instant of the last message, not of this refresh: a thread summarised
    // today whose last message was in March belongs in March.
    expect(row.occurred_at).toBe(baseThread.last_message_at);
    // The same key the ingest wrote under, or this adds a copy instead of
    // correcting one. Asserted as the shape PostgREST accepts, not as equality
    // with a constant this repo also owns.
    for (const column of recorded.upserts[0].onConflict.split(",")) {
      expect(column).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });

  it("writes no CRM entry for a counterparty the CRM does not hold", async () => {
    const { supabase, recorded } = makeSupabase({
      thread: baseThread,
      messages: [{ direction: "inbound", author: "Dana", body: "Any news?" }],
    });
    await refreshThreadSummary(supabase, "org-1", "thr-1", {
      summarize: async () => ({ summary: "s", intent: "i" }),
    });
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.upserts).toHaveLength(0);
  });
});
