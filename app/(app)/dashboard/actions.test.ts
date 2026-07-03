// Coverage for the "Clear all deals" safety fix: clearDeals used to run a
// hard `.delete()` across every deal row for the org — cascading to every
// document, underwriting, and diligence item tied to those deals (see
// supabase/migrations/0005_deals.sql), behind a single dismissible
// window.confirm(), with no undo. It now soft-archives (archived_at),
// matching the archived_at pattern already used for deals everywhere else
// in the app, so a mis-click is recoverable.

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const requireOrgContext = jest.fn();
jest.mock("@/lib/auth", () => ({
  getSessionContext: jest.fn(),
  requireOrgContext: (...a: unknown[]) => requireOrgContext(...a),
}));

const from = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from: (...a: unknown[]) => from(...a) }),
}));

import { clearDeals } from "./actions";

const AUTH_OK = { ok: true, ctx: { orgId: "org-1", userId: "user-1" } };

function makeFromStub(error: { message: string } | null = null) {
  return () => {
    const builder: Record<string, unknown> = {
      update: () => builder,
      eq: () => builder,
      is: () => builder,
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve({ error }).then(onFulfilled),
    };
    return builder;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireOrgContext.mockResolvedValue(AUTH_OK);
  from.mockImplementation(makeFromStub());
});

describe("clearDeals", () => {
  it("rejects when not authorized, without touching the DB", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const result = await clearDeals();
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("archives (does not delete) every un-archived deal for the org", async () => {
    let capturedTable: string | undefined;
    const update = jest.fn((patch: unknown) => {
      expect(patch).toEqual({ archived_at: expect.any(String) });
      return builder;
    });
    const eq = jest.fn(() => builder);
    const is = jest.fn(() => builder);
    const builder: Record<string, unknown> = {
      update,
      eq,
      is,
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(onFulfilled),
    };
    from.mockImplementation((table: string) => {
      capturedTable = table;
      return builder;
    });

    const result = await clearDeals();

    expect(result).toEqual({ ok: true });
    expect(capturedTable).toBe("deals");
    expect(update).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(is).toHaveBeenCalledWith("archived_at", null);
  });

  it("surfaces a DB error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ message: "update failed" }));
    const result = await clearDeals();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("update failed");
  });
});
