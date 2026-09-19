// Deleting a meeting, and the bytes the cascade could never reach.
//
// live_meeting_recordings cascades from live_meetings and the chunk rows
// cascade from that, so a hard delete removed every row that knew a recording
// existed — and left the recording in the bucket. Not even readable afterwards:
// the Storage policy resolves attended_live_meeting() through live_meetings,
// whose row is now gone. Deleted, told it was done, and kept.

const authMock = jest.fn();
const rlsFrom = jest.fn();

const state: {
  /** Meeting ids the delete reports it removed. */
  removedRows: Array<{ id: string }>;
  /** Meetings whose recording folder was listed, in order. */
  foldersListed: string[];
  /** Object paths removed from the bucket. */
  objectsRemoved: string[];
  deleteError: { message: string } | null;
  /** The enumeration of what a clear-all would delete fails. */
  readError: { message: string } | null;
  /** Called on every bucket listing, so a test can watch concurrency. */
  onList: (() => Promise<void>) | null;
  listThrows: boolean;
  /** The last filters applied, so a test can pin what the delete was scoped to. */
  filters: Record<string, unknown>;
  mode: string;
  patch: Record<string, unknown> | null;
  hasService: boolean;
} = {
  removedRows: [],
  foldersListed: [],
  objectsRemoved: [],
  deleteError: null,
  readError: null,
  onList: null,
  listThrows: false,
  filters: {},
  mode: "",
  patch: null,
  hasService: true,
};

/** The bucket: one recording folder per meeting, two parts in each. */
function storage() {
  return {
    from: () => ({
      list: async (prefix: string) => {
        if (state.listThrows) return { data: null, error: { message: "storage down" } };
        if (state.onList) await state.onList();
        state.foldersListed.push(prefix);
        // "<meeting>" lists its recordings; "<meeting>/<recording>" its parts.
        return prefix.includes("/")
          ? { data: [{ name: "part-000000.webm" }, { name: "part-000001.webm" }], error: null }
          : { data: [{ name: "rec-1" }], error: null };
      },
      remove: async (paths: string[]) => {
        state.objectsRemoved.push(...paths);
        return { error: null };
      },
    }),
  };
}

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => state.hasService,
  createServerClient: async () => ({ from: (...a: unknown[]) => rlsFrom(...a) }),
  createServiceClient: () => ({ storage: storage() }),
}));

import { NextRequest } from "next/server";
import { DELETE } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/meetings/delete", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

function meetingsBuilder() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    update: (p: Record<string, unknown>) => { state.mode = "update"; state.patch = p; return chain; },
    delete: () => { state.mode = "delete"; return chain; },
    eq: (col: string, val: unknown) => { state.filters[col] = val; return chain; },
    is: (col: string, val: unknown) => { state.filters[col] = val; return chain; },
    order: () => chain,
    // Both actually apply their bound. A harness that answered with every row
    // regardless would report a capped read as though it had read everything —
    // which is precisely the defect these tests exist to catch.
    limit: (n: number) => Promise.resolve({ data: state.removedRows.slice(0, n), error: state.readError }),
    range: (from: number, to: number) =>
      Promise.resolve({ data: state.removedRows.slice(from, to + 1), error: state.readError }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve({ data: state.removedRows, error: state.deleteError })),
  };
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  state.removedRows = [{ id: "m1" }];
  state.foldersListed = [];
  state.objectsRemoved = [];
  state.deleteError = null;
  state.readError = null;
  state.onList = null;
  state.listThrows = false;
  state.filters = {};
  state.mode = "";
  state.patch = null;
  state.hasService = true;
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "host-1" } });
  rlsFrom.mockImplementation(() => meetingsBuilder());
});

describe("a hard delete takes the recording with it", () => {
  it("removes every part of the meeting's recording", async () => {
    const res = await DELETE(req({ meetingId: "m1" }));
    expect(res.status).toBe(200);
    expect(state.objectsRemoved).toEqual([
      "m1/rec-1/part-000000.webm",
      "m1/rec-1/part-000001.webm",
    ]);
  });

  // The objects are keyed on the meeting id, and after the cascade there is
  // nothing left to look them up by — so the ids have to be read while the
  // rows still exist.
  it("clears the recordings of every meeting a clear-all removed", async () => {
    state.removedRows = [{ id: "m1" }, { id: "m2" }];
    await DELETE(req({ clearAll: true }));
    expect(state.foldersListed).toEqual(expect.arrayContaining(["m1", "m2"]));
  });

  // A clear-all deletes every meeting the host has, so reading only the first
  // page of them strands the recordings of all the rest — the same "a cap
  // quietly orphans the remainder" defect this route was written to fix,
  // one level up.
  it("clears the recordings of more meetings than one page of them holds", async () => {
    state.removedRows = Array.from({ length: 600 }, (_, i) => ({ id: `m${i}` }));
    const res = await DELETE(req({ clearAll: true }));
    expect(res.status).toBe(200);
    // Meeting-level prefixes only; each meeting also has its recording's parts
    // listed under "<meeting>/<recording>".
    const meetings = state.foldersListed.filter((prefix) => !prefix.includes("/"));
    expect(meetings).toContain("m0");
    expect(meetings).toContain("m599");
    expect(meetings).toHaveLength(600);
  });

  // An unbounded fan-out opens a Storage request per meeting at once, and the
  // failure lands after the rows are already gone — the exact state this route
  // exists to avoid. The pool is what makes a big clear-all cost the same
  // number of concurrent requests as a small one.
  it("never has more than the pool's worth of removals in flight", async () => {
    state.removedRows = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}` }));
    let inFlight = 0;
    let peak = 0;
    state.onList = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight -= 1;
    };
    await DELETE(req({ clearAll: true }));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(8);
  });

  // Fails closed. Deleting first and finding out afterwards that the list could
  // not be read is the exact outcome this route exists to prevent: rows gone,
  // objects stranded, and a 200 saying it was done.
  it("refuses a clear-all it could not enumerate, rather than deleting blind", async () => {
    state.readError = { message: "read failed" };
    const res = await DELETE(req({ clearAll: true }));
    expect(res.status).toBe(500);
    expect(state.mode).not.toBe("delete");
    expect(state.objectsRemoved).toEqual([]);
  });

  // Ownership is proved by the delete itself, which is scoped to this host in
  // this org. Without that, naming somebody else's meeting id would delete
  // their recording while the row correctly refused to budge.
  it("removes nothing when the delete matched no row", async () => {
    state.removedRows = [];
    await DELETE(req({ meetingId: "not-theirs" }));
    expect(state.objectsRemoved).toEqual([]);
  });

  it("still scopes the delete to the caller's org and host", async () => {
    await DELETE(req({ meetingId: "m1" }));
    expect(state.mode).toBe("delete");
    expect(state.filters).toMatchObject({ id: "m1", organization_id: "org1", host_id: "host-1" });
  });
});

describe("a soft delete keeps it", () => {
  // A soft-deleted meeting is one the host can restore, and its recording is
  // still readable through the report. Removing the bytes would make "restore"
  // a lie.
  it("leaves the objects alone", async () => {
    await DELETE(req({ meetingId: "m1", soft: true }));
    expect(state.mode).toBe("update");
    expect(state.patch).toMatchObject({ deleted_at: expect.any(String) });
    expect(state.objectsRemoved).toEqual([]);
  });

  it("leaves them alone on a clear-all too", async () => {
    await DELETE(req({ clearAll: true, soft: true }));
    expect(state.objectsRemoved).toEqual([]);
  });
});

describe("when the bytes cannot be removed", () => {
  // The rows are gone by the time this runs, so failing the request would tell
  // the host their meeting is still there when it is not. The sweep's orphan
  // pass looks for exactly this: a meeting folder with no meeting.
  it("still reports the meeting deleted", async () => {
    state.listThrows = true;
    const res = await DELETE(req({ meetingId: "m1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("still reports it when there is no service role to delete with", async () => {
    state.hasService = false;
    const res = await DELETE(req({ meetingId: "m1" }));
    expect(res.status).toBe(200);
    expect(state.objectsRemoved).toEqual([]);
  });

  // A failed delete must not go on to remove the objects of a meeting that is
  // still there.
  it("does not touch the bucket when the delete itself failed", async () => {
    state.deleteError = { message: "nope" };
    const res = await DELETE(req({ meetingId: "m1" }));
    expect(res.status).toBe(500);
    expect(state.objectsRemoved).toEqual([]);
  });
});

describe("authorization", () => {
  it("refuses a caller with no org context", async () => {
    authMock.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    const res = await DELETE(req({ meetingId: "m1" }));
    expect(res.status).toBe(401);
    expect(state.objectsRemoved).toEqual([]);
  });

  it("400s without a meeting to delete", async () => {
    const res = await DELETE(req({}));
    expect(res.status).toBe(400);
  });
});
