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
}

function makeSupabase(opts: {
  thread?: ThreadRow | null;
  messages?: MessageRow[];
  threadError?: boolean;
}): { supabase: SupabaseClient<Database>; recorded: Recorded } {
  const recorded: Recorded = { updates: [] };

  const from = (table: string) => {
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
});
