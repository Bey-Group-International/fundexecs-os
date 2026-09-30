/**
 * Reading and clearing the drafts held against a thread.
 *
 * Both of these are best-effort by design, and the tests say which way each one
 * fails: a draft that cannot be READ costs a badge, and a draft that cannot be
 * CLEARED must not turn a reply that has already gone out into an error.
 */
import { DRAFT_LIMIT } from "./drafts";
import { clearThreadDraft, readThreadDrafts } from "./drafts.server";

const REVISION = "2026-09-30T12:00:00.000Z";

const ROW = {
  thread_id: "t1",
  body: "Hi Ana,",
  source: "meeting_follow_up",
  source_meeting_id: "m1",
  updated_at: "2026-09-30T12:00:00.000Z",
};

interface Recorded {
  table: string;
  limit: number | null;
  order: Array<[string, unknown]>;
  deleted: boolean;
  eq: Array<[string, unknown]>;
}

function client(
  opts: { rows?: unknown[]; error?: string; throws?: boolean } = {},
): { api: never; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const api = {
    from(table: string) {
      if (opts.throws) throw new Error("boom");
      const rec: Recorded = { table, limit: null, order: [], deleted: false, eq: [] };
      calls.push(rec);
      const answer = opts.error
        ? { data: null, error: { message: opts.error } }
        : { data: opts.rows ?? [], error: null };
      const chain = {
        select: () => chain,
        order: (col: string, val: unknown) => {
          rec.order.push([col, val]);
          return chain;
        },
        limit: (n: number) => {
          rec.limit = n;
          return Promise.resolve(answer);
        },
        delete: () => {
          rec.deleted = true;
          return chain;
        },
        // Both a builder and a promise: the delete chains two eq() calls (thread
        // and revision) and awaits the last one.
        eq: (col: string, val: unknown) => {
          rec.eq.push([col, val]);
          return Object.assign(Promise.resolve(answer), chain);
        },
      };
      return chain;
    },
  };
  return { api: api as never, calls };
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading them", () => {
  it("keys them by thread, which is what the board looks them up by", async () => {
    const { api } = client({ rows: [ROW] });
    const drafts = await readThreadDrafts(api);
    expect(drafts.get("t1")).toEqual({
      threadId: "t1",
      body: "Hi Ana,",
      source: "meeting_follow_up",
      sourceMeetingId: "m1",
      updatedAt: "2026-09-30T12:00:00.000Z",
    });
  });

  // Newest first, so if the ceiling ever bites it drops the stalest drafts rather
  // than an arbitrary set.
  it("is bounded, newest first", async () => {
    const { api, calls } = client({ rows: [ROW] });
    await readThreadDrafts(api);
    expect(calls[0].limit).toBe(DRAFT_LIMIT);
    expect(calls[0].order).toEqual([["updated_at", { ascending: false }]]);
  });

  it("comes back empty on an error rather than failing the board", async () => {
    const { api } = client({ error: "denied" });
    expect((await readThreadDrafts(api)).size).toBe(0);
  });

  it("comes back empty rather than throwing", async () => {
    const { api } = client({ throws: true });
    await expect(readThreadDrafts(api)).resolves.toEqual(new Map());
  });
});

describe("clearing one", () => {
  /**
   * Conditioned on the revision, which makes this a compare-and-set rather than a
   * blind delete. A thread's draft is REPLACED — thread_id is the primary key — so
   * deleting by thread alone let an operator who opened on draft v1 destroy a v2
   * the report wrote afterwards, without anyone ever seeing it.
   */
  it("deletes only the revision the reply was composed from", async () => {
    const { api, calls } = client();
    expect(await clearThreadDraft(api, "t1", REVISION)).toBe(true);
    expect(calls[0].table).toBe("inbox_thread_drafts");
    expect(calls[0].deleted).toBe(true);
    expect(calls[0].eq).toEqual([
      ["thread_id", "t1"],
      ["updated_at", REVISION],
    ]);
  });

  /**
   * No revision, no delete — and that is the safe direction, not a gap. A draft
   * left behind is visible in the composer and discardable by hand; a newer draft
   * deleted by an older send is gone with nothing to recover it from.
   */
  it.each([undefined, null, ""])("deletes nothing when the revision is %p", async (rev) => {
    const { api, calls } = client();
    expect(await clearThreadDraft(api, "t1", rev)).toBe(false);
    expect(calls).toEqual([]);
  });

  /**
   * Reports the failure and does not raise it. The caller has already sent the
   * reply by this point — turning a stale draft into an error the operator sees
   * after a successful send would be worse than the stale draft.
   */
  it("reports a failure without throwing", async () => {
    const { api } = client({ error: "denied" });
    expect(await clearThreadDraft(api, "t1", REVISION)).toBe(false);
  });

  it("does not throw when the client itself does", async () => {
    const { api } = client({ throws: true });
    await expect(clearThreadDraft(api, "t1", REVISION)).resolves.toBe(false);
  });
});
