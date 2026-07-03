// Coverage for the deal-lifecycle atomicity fix: recordIcDecision used to
// insert the ic_decisions row and (for go/no_go) advance the deal stage as
// two independent, unchecked Supabase calls, returning void. It now delegates
// both writes to one atomic RPC
// (supabase/migrations/20260703200000_deal_lifecycle_atomic.sql) and returns
// {ok, error} instead of void.

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const getSessionContext = jest.fn();
jest.mock("@/lib/auth", () => ({ getSessionContext: (...a: unknown[]) => getSessionContext(...a) }));

const computeDealConviction = jest.fn();
const recordConvictionSnapshot = jest.fn();
jest.mock("@/lib/run-war-room", () => ({
  computeDealConviction: (...a: unknown[]) => computeDealConviction(...a),
  recordConvictionSnapshot: (...a: unknown[]) => recordConvictionSnapshot(...a),
}));

jest.mock("@/lib/deal-share.server", () => ({ shareDeal: jest.fn() }));

const rpc = jest.fn();
const from = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) }),
}));

import { recordIcDecision, addDiligenceItem, updateDiligenceItem, addUnderwriting } from "./actions";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// A chainable insert/update stub: .insert()/.update()/.eq() all return the
// same builder, and awaiting the chain resolves to {error} via the thenable
// protocol — mirrors the Supabase query-builder shape.
function makeFromStub(error: { message: string } | null = null) {
  return () => {
    const builder: Record<string, unknown> = {
      insert: () => builder,
      update: () => builder,
      eq: () => builder,
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve({ error }).then(onFulfilled),
    };
    return builder;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getSessionContext.mockResolvedValue({ orgId: "org-1", userId: "user-1" });
  computeDealConviction.mockResolvedValue({ score: 72 });
  recordConvictionSnapshot.mockResolvedValue(undefined);
  from.mockImplementation(makeFromStub());
});

describe("recordIcDecision", () => {
  it("rejects when there's no active org, without touching the RPC", async () => {
    getSessionContext.mockResolvedValue(null);
    const result = await recordIcDecision(formData({ deal_id: "d1", decision: "go" }));
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing deal or invalid decision before any RPC call", async () => {
    const missingDeal = await recordIcDecision(formData({ deal_id: "", decision: "go" }));
    expect(missingDeal.ok).toBe(false);
    const badDecision = await recordIcDecision(formData({ deal_id: "d1", decision: "maybe" }));
    expect(badDecision.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_ic_decision with the conviction snapshot and returns ok on success", async () => {
    rpc.mockResolvedValue({ data: { decisionId: "dec-1" }, error: null });

    const result = await recordIcDecision(formData({ deal_id: "d1", decision: "go", rationale: "Strong thesis fit" }));

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("record_ic_decision", {
      p_org: "org-1",
      p_deal_id: "d1",
      p_decision: "go",
      p_rationale: "Strong thesis fit",
      p_conviction: 72,
      p_decided_by: "user-1",
    });
    expect(recordConvictionSnapshot).toHaveBeenCalledWith(expect.anything(), "org-1", "d1");
  });

  it("surfaces an RPC error as {ok:false} and never records a conviction snapshot", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "deal d1 not found" } });

    const result = await recordIcDecision(formData({ deal_id: "d1", decision: "hold" }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
    expect(recordConvictionSnapshot).not.toHaveBeenCalled();
  });
});

// Coverage for the diligence/underwriting error-handling fix: these three
// used to be `Promise<void>` with their Supabase write unchecked — a failed
// insert/update looked identical to success. They now return {ok, error}.
describe("addDiligenceItem", () => {
  it("rejects when there's no active org, without touching the DB", async () => {
    getSessionContext.mockResolvedValue(null);
    const result = await addDiligenceItem(formData({ deal_id: "d1", title: "Check leases" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a missing deal or title before any DB call", async () => {
    const result = await addDiligenceItem(formData({ deal_id: "", title: "Check leases" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an insert error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ message: "insert failed" }));
    const result = await addDiligenceItem(formData({ deal_id: "d1", title: "Check leases" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("insert failed");
    expect(recordConvictionSnapshot).not.toHaveBeenCalled();
  });

  it("records a conviction snapshot and returns ok on success", async () => {
    const result = await addDiligenceItem(formData({ deal_id: "d1", title: "Check leases" }));
    expect(result).toEqual({ ok: true });
    expect(recordConvictionSnapshot).toHaveBeenCalledWith(expect.anything(), "org-1", "d1");
  });
});

describe("updateDiligenceItem", () => {
  it("rejects a missing id before any DB call", async () => {
    const result = await updateDiligenceItem(formData({ deal_id: "d1", status: "cleared" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an update error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ message: "update failed" }));
    const result = await updateDiligenceItem(formData({ id: "item-1", deal_id: "d1", status: "cleared" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("update failed");
  });

  it("returns ok on success", async () => {
    const result = await updateDiligenceItem(formData({ id: "item-1", deal_id: "d1", status: "cleared" }));
    expect(result).toEqual({ ok: true });
  });
});

describe("addUnderwriting", () => {
  it("rejects a missing deal before any DB call", async () => {
    const result = await addUnderwriting(formData({ name: "Base case" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an insert error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ message: "insert failed" }));
    const result = await addUnderwriting(formData({ deal_id: "d1", name: "Base case" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("insert failed");
  });

  it("returns ok on success", async () => {
    const result = await addUnderwriting(formData({ deal_id: "d1", name: "Base case" }));
    expect(result).toEqual({ ok: true });
  });
});
