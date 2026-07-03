// Coverage for the capital-atomicity fix: recordCapitalRun and
// recordSecondaryTransfer used to write capital_events/commitments/funds as a
// loop of independent, unchecked Supabase calls (no transaction, no error
// checked, JS read-then-write increments). They now validate inputs, then
// delegate the entire write set to one atomic RPC
// (supabase/migrations/20260703180000_capital_ops_atomic.sql) and return
// {ok, error} instead of void. These tests lock in: (1) invalid input never
// reaches the RPC, (2) a well-formed request calls the RPC with the correct
// shape, (3) an RPC error surfaces as {ok:false} rather than being swallowed.

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

import { recordCapitalRun, recordSecondaryTransfer } from "./actions";

const AUTH_OK = { ok: true, ctx: { orgId: "org-1", userId: "user-1" } };

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// A tiny query-builder stub: chainable .select/.eq/.maybeSingle resolving to
// pre-set rows keyed by table name.
function makeFromStub(rows: Record<string, unknown>) {
  return (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows[`${table}[]`] ?? [], error: null }).then(onFulfilled),
    };
    return builder;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireOrgContext.mockResolvedValue(AUTH_OK);
});

describe("recordCapitalRun", () => {
  it("rejects when not authorized, without touching the RPC", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const result = await recordCapitalRun(formData({ fund_id: "f1", kind: "capital_call", amount: "100" }));
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing fund or invalid kind before any DB call", async () => {
    const result = await recordCapitalRun(formData({ fund_id: "", kind: "capital_call", amount: "100" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-positive amount before any DB call", async () => {
    const result = await recordCapitalRun(formData({ fund_id: "f1", kind: "capital_call", amount: "0" }));
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects when the fund doesn't exist for this org", async () => {
    from.mockImplementation(makeFromStub({ funds: null }));
    const result = await recordCapitalRun(formData({ fund_id: "f1", kind: "capital_call", amount: "100" }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fund/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects when the fund has no commitments to allocate across", async () => {
    from.mockImplementation(makeFromStub({ funds: { id: "f1" }, "commitments[]": [] }));
    const result = await recordCapitalRun(formData({ fund_id: "f1", kind: "capital_call", amount: "100" }));
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls capital_run_apply with the planned allocations and returns ok on success", async () => {
    from.mockImplementation(
      makeFromStub({
        funds: { id: "f1" },
        "commitments[]": [
          { id: "c1", investor_id: "inv-1", committed_amount: 3_000_000, called_amount: 0, distributed_amount: 0 },
          { id: "c2", investor_id: "inv-2", committed_amount: 1_000_000, called_amount: 0, distributed_amount: 0 },
        ],
      }),
    );
    rpc.mockResolvedValue({ data: { totalApplied: 1_000_000 }, error: null });

    const result = await recordCapitalRun(
      formData({ fund_id: "f1", kind: "capital_call", amount: "1000000", reference: "Call #1" }),
    );

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("capital_run_apply");
    expect(args.p_org).toBe("org-1");
    expect(args.p_fund_id).toBe("f1");
    expect(args.p_kind).toBe("capital_call");
    expect(args.p_reference).toBe("Call #1");
    expect(args.p_allocations).toEqual([
      { commitmentId: "c1", investorId: "inv-1", allocation: 750_000 },
      { commitmentId: "c2", investorId: "inv-2", allocation: 250_000 },
    ]);
  });

  it("surfaces an RPC error as {ok:false} instead of throwing or silently succeeding", async () => {
    from.mockImplementation(
      makeFromStub({
        funds: { id: "f1" },
        "commitments[]": [
          { id: "c1", investor_id: "inv-1", committed_amount: 1_000_000, called_amount: 0, distributed_amount: 0 },
        ],
      }),
    );
    rpc.mockResolvedValue({ data: null, error: { message: "capital call of 500000 would exceed commitment" } });

    const result = await recordCapitalRun(formData({ fund_id: "f1", kind: "capital_call", amount: "500000" }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("exceed commitment");
  });
});

describe("recordSecondaryTransfer", () => {
  it("rejects when not authorized, without touching the RPC", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const result = await recordSecondaryTransfer(
      formData({ seller_commitment_id: "c1", buyer_investor_id: "inv-2", fraction: "1" }),
    );
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects missing seller/buyer or a non-positive fraction before any RPC call", async () => {
    const missing = await recordSecondaryTransfer(formData({ seller_commitment_id: "", buyer_investor_id: "inv-2", fraction: "1" }));
    expect(missing.ok).toBe(false);
    const zero = await recordSecondaryTransfer(
      formData({ seller_commitment_id: "c1", buyer_investor_id: "inv-2", fraction: "0" }),
    );
    expect(zero.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("clamps a fraction above 1 to 1 and calls capital_secondary_transfer", async () => {
    rpc.mockResolvedValue({ data: { fundId: "f1", committed: 100, called: 0, distributed: 0 }, error: null });

    const result = await recordSecondaryTransfer(
      formData({ seller_commitment_id: "c1", buyer_investor_id: "inv-2", fraction: "1.5" }),
    );

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("capital_secondary_transfer", {
      p_org: "org-1",
      p_seller_commitment_id: "c1",
      p_buyer_investor_id: "inv-2",
      p_fraction: 1,
    });
  });

  it("surfaces an RPC error (e.g. self-transfer guard) as {ok:false}", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "buyer and seller must be different investors" } });

    const result = await recordSecondaryTransfer(
      formData({ seller_commitment_id: "c1", buyer_investor_id: "inv-1", fraction: "1" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("different investors");
  });
});
