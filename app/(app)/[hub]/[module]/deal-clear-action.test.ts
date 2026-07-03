// Coverage for the "Clear all deals" safety fix: clearDealsAction used to run
// on createServiceClient() — a service-role client that bypasses RLS — while
// every other single-row action on this table (deleteDealAction, right above
// it) already used the org-scoped createServerClient(). Since requireOrgContext
// doesn't check role, and RLS's deals_write policy is what actually blocks the
// 'viewer' role, running this one action on the service client meant a viewer
// could archive the entire pipeline despite being read-only everywhere else.
// It now uses createServerClient(), matching its sibling.

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const requireOrgContext = jest.fn();
jest.mock("@/lib/auth", () => ({
  getSessionContext: jest.fn(),
  requireOrgContext: (...a: unknown[]) => requireOrgContext(...a),
}));

const serverFrom = jest.fn();
const createServerClient = jest.fn(() => ({ from: (...a: unknown[]) => serverFrom(...a) }));
const createServiceClient = jest.fn(() => {
  throw new Error("clearDealsAction must not use the service-role client");
});
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => createServerClient(),
  createServiceClient: () => createServiceClient(),
}));

import { clearDealsAction } from "./actions";

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
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "user-1" } });
  serverFrom.mockImplementation(makeFromStub());
});

describe("clearDealsAction", () => {
  it("uses the org-scoped client, never the service-role client", async () => {
    const result = await clearDealsAction();
    expect(result.ok).toBe(true);
    expect(createServerClient).toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("rejects when not authorized, without touching the DB", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const result = await clearDealsAction();
    expect(result.error).toBeTruthy();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("surfaces a DB error instead of silently succeeding", async () => {
    serverFrom.mockImplementation(makeFromStub({ message: "update failed" }));
    const result = await clearDealsAction();
    expect(result.error).toBeTruthy();
  });
});
