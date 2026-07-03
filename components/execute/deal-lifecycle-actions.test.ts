// Coverage for the deal-lifecycle atomicity fix: promoteDealToAsset and
// recordValuationMark used to write their pair of rows as two independent,
// unchecked Supabase calls (no transaction, no error checked), returning void.
// They now validate inputs, then delegate the whole write set to one atomic
// RPC (supabase/migrations/20260703200000_deal_lifecycle_atomic.sql) and
// return {ok, error} instead of void.

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const requireOrgContext = jest.fn();
jest.mock("@/lib/auth", () => ({
  getSessionContext: jest.fn(),
  requireOrgContext: (...args: unknown[]) => requireOrgContext(...args),
}));

const rpc = jest.fn();
const from = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) }),
}));

import { promoteDealToAsset, recordValuationMark } from "./actions";

const AUTH_OK = { ok: true, ctx: { orgId: "org-1", userId: "user-1" } };

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function makeFromStub(rows: Record<string, unknown>) {
  return (table: string) => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) }),
      }),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireOrgContext.mockResolvedValue(AUTH_OK);
});

describe("promoteDealToAsset", () => {
  it("rejects when not authorized, without touching the RPC", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const result = await promoteDealToAsset(formData({ deal_id: "d1" }));
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing deal id before any DB call", async () => {
    const result = await promoteDealToAsset(formData({}));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects when the deal doesn't exist for this org", async () => {
    from.mockImplementation(makeFromStub({ deals: null }));
    const result = await promoteDealToAsset(formData({ deal_id: "d1" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/deal/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls promote_deal_to_asset with the mapped asset type and returns ok on success", async () => {
    from.mockImplementation(makeFromStub({ deals: { id: "d1", asset_class: "Venture / SaaS" } }));
    rpc.mockResolvedValue({ data: { assetId: "a1" }, error: null });

    const result = await promoteDealToAsset(formData({ deal_id: "d1" }));

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("promote_deal_to_asset", {
      p_org: "org-1",
      p_deal_id: "d1",
      p_asset_type: "portfolio_company",
    });
  });

  it("surfaces an RPC error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ deals: { id: "d1", asset_class: null } }));
    rpc.mockResolvedValue({ data: null, error: { message: "deal d1 not found" } });

    const result = await promoteDealToAsset(formData({ deal_id: "d1" }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("recordValuationMark", () => {
  it("rejects when not authorized, without touching the RPC", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const result = await recordValuationMark(formData({ asset_id: "a1", value: "100" }));
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing asset or non-numeric value before any RPC call", async () => {
    const missing = await recordValuationMark(formData({ asset_id: "", value: "100" }));
    expect(missing.ok).toBe(false);
    const nan = await recordValuationMark(formData({ asset_id: "a1", value: "not-a-number" }));
    expect(nan.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_valuation_mark with the given fields and returns ok on success", async () => {
    rpc.mockResolvedValue({ data: { markId: "m1" }, error: null });

    const result = await recordValuationMark(
      formData({ asset_id: "a1", value: "2500000", as_of: "2026-07-01", method: "DCF", note: "Q2 mark" }),
    );

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("record_valuation_mark", {
      p_org: "org-1",
      p_asset_id: "a1",
      p_value: 2_500_000,
      p_as_of: "2026-07-01",
      p_method: "DCF",
      p_note: "Q2 mark",
      p_created_by: "user-1",
    });
  });

  it("surfaces an RPC error as {ok:false} instead of silently succeeding", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "asset a1 not found" } });

    const result = await recordValuationMark(formData({ asset_id: "a1", value: "100" }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });
});
