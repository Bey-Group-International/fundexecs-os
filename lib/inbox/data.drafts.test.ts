/**
 * getInboxThreads and the drafts a meeting report left on the board.
 *
 * A separate file from data.test.ts, which covers refreshThreadSummary and builds
 * a fake shaped for it. This one needs a client that can answer the board's page
 * read, the drafts read and the backfill read, and asserts the three properties
 * that only exist between them:
 *
 *   - the draft reaches the view, so the card can say a reply is waiting;
 *   - a draft-carrying thread comes FIRST, because the board's own ordering
 *     (priority, then recency) puts a brand-new follow-up thread last;
 *   - a draft-carrying thread that fell off the hundred-row page is fetched, and
 *     is NOT fetched while a filter is active.
 *
 * The middle two are the ones that matter. Without them the feature ships looking
 * complete: the draft exists, the badge renders, and the thread is on page two of a
 * board that has no page two.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getInboxThreads } from "./data";

function thread(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    organization_id: "org-1",
    channel: "gmail",
    category: "messaging",
    subject: "Pacing",
    counterparty_name: "Ana Diaz",
    counterparty_email: "ana@acme.com",
    preview: null,
    status: "open",
    unread: false,
    priority: 40,
    intent: null,
    ai_summary: null,
    last_message_at: "2026-09-01T00:00:00.000Z",
    meeting_at: null,
    meeting_url: null,
    deal_id: null,
    investor_id: null,
    created_by: null,
    assigned_to: null,
    snoozed_until: null,
    external_id: null,
    starred: false,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function draftRow(threadId: string) {
  return {
    thread_id: threadId,
    body: "Hi Ana,",
    source: "meeting_follow_up",
    source_meeting_id: "m1",
    updated_at: "2026-09-30T12:00:00.000Z",
  };
}

/** What the board asked for beyond the page read. */
interface Asked {
  backfilledIds: string[] | null;
  readDrafts: boolean;
}

function client(opts: {
  page?: Record<string, unknown>[];
  drafts?: Record<string, unknown>[];
  offPage?: Record<string, unknown>[];
}): { supabase: SupabaseClient<Database>; asked: Asked } {
  const asked: Asked = { backfilledIds: null, readDrafts: false };

  const from = (table: string) => {
    if (table === "inbox_thread_drafts") {
      asked.readDrafts = true;
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: async () => ({ data: opts.drafts ?? [], error: null }),
      };
      return chain;
    }
    if (table === "inbox_threads") {
      // Two different reads land here. The page read ends in .limit(); the
      // backfill ends in .in(...).neq(...) and is awaited as the builder itself,
      // so this has to be both a builder and a promise.
      let isBackfill = false;
      const result = () =>
        isBackfill
          ? { data: opts.offPage ?? [], error: null }
          : { data: opts.page ?? [], error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        or: () => chain,
        order: () => chain,
        neq: () => Object.assign(Promise.resolve(result()), chain),
        in: (_col: string, ids: string[]) => {
          isBackfill = true;
          asked.backfilledIds = ids;
          return Object.assign(Promise.resolve(result()), chain);
        },
        limit: async () => result(),
      };
      return chain;
    }
    // deals / investors / principals: nothing to resolve in these cases.
    const chain = { select: () => chain, in: async () => ({ data: [] }) };
    return chain;
  };

  return { supabase: { from } as unknown as SupabaseClient<Database>, asked };
}

describe("the draft on a thread", () => {
  it("reaches the view, so the card can say a reply is waiting", async () => {
    const { supabase } = client({ page: [thread()], drafts: [draftRow("t1")] });
    const views = await getInboxThreads(supabase);
    expect(views[0].draft).toEqual({
      threadId: "t1",
      body: "Hi Ana,",
      source: "meeting_follow_up",
      sourceMeetingId: "m1",
      updatedAt: "2026-09-30T12:00:00.000Z",
    });
  });

  it("is null on every other thread", async () => {
    const { supabase } = client({ page: [thread()], drafts: [] });
    expect((await getInboxThreads(supabase)).at(0)?.draft).toBeNull();
  });
});

describe("where a draft-carrying thread ends up", () => {
  /**
   * The property the whole feature rests on. A thread created to hold a follow-up
   * has priority 0 and no messages, so under the board's ordering it is last of the
   * hundred — which means the one thread somebody was told to act on is the one
   * they scroll past.
   */
  it("comes first, ahead of higher-priority threads with nothing waiting", async () => {
    const { supabase } = client({
      page: [
        thread({ id: "hot", priority: 90 }),
        thread({ id: "warm", priority: 50 }),
        thread({ id: "new-followup", priority: 0, last_message_at: null }),
      ],
      drafts: [draftRow("new-followup")],
    });
    expect((await getInboxThreads(supabase)).map((v) => v.thread.id)).toEqual([
      "new-followup",
      "hot",
      "warm",
    ]);
  });

  it("leaves the board's own ordering alone below it", async () => {
    const { supabase } = client({
      page: [thread({ id: "hot", priority: 90 }), thread({ id: "warm", priority: 50 })],
      drafts: [],
    });
    expect((await getInboxThreads(supabase)).map((v) => v.thread.id)).toEqual(["hot", "warm"]);
  });
});

describe("a draft-carrying thread the page read missed", () => {
  it("is fetched and put in front", async () => {
    const { supabase, asked } = client({
      page: [thread({ id: "hot", priority: 90 })],
      drafts: [draftRow("off-page")],
      offPage: [thread({ id: "off-page", priority: 0, last_message_at: null })],
    });

    const views = await getInboxThreads(supabase);

    expect(asked.backfilledIds).toEqual(["off-page"]);
    expect(views.map((v) => v.thread.id)).toEqual(["off-page", "hot"]);
    expect(views[0].draft?.threadId).toBe("off-page");
  });

  it("is not fetched when it is already on the page", async () => {
    const { supabase, asked } = client({ page: [thread()], drafts: [draftRow("t1")] });
    await getInboxThreads(supabase);
    expect(asked.backfilledIds).toBeNull();
  });

  /**
   * A filtered board shows what matches the filter. Pulling a thread in because it
   * happens to hold a draft would show a read thread under "unread only", with
   * nothing to explain it.
   */
  it.each([
    ["a search", { q: "acme" }],
    ["unread only", { unreadOnly: true }],
    ["starred only", { starredOnly: true }],
    ["a channel", { channel: "gmail" as const }],
    ["an assignee", { assignedTo: "p1" }],
  ])("is not fetched under %s", async (_label, filters) => {
    const { supabase, asked } = client({
      page: [thread({ id: "hot" })],
      drafts: [draftRow("off-page")],
      offPage: [thread({ id: "off-page" })],
    });
    const views = await getInboxThreads(supabase, filters);
    expect(asked.backfilledIds).toBeNull();
    expect(views.map((v) => v.thread.id)).toEqual(["hot"]);
  });
});

describe("when the board has nothing", () => {
  it("still reads the drafts rather than short-circuiting them away", async () => {
    // They start together, so a board with no threads has still paid for and
    // resolved the drafts read — which is what keeps the two from serialising.
    const { supabase, asked } = client({ page: [], drafts: [] });
    expect(await getInboxThreads(supabase)).toEqual([]);
    expect(asked.readDrafts).toBe(true);
  });
});
