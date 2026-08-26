// The calendar-status endpoint exists to keep the connection panel honest, so
// these tests are mostly about what it must NOT claim.
const authMock = jest.fn();
const from = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: () => ({ from }) }));

import { GET } from "./route";

/** Chainable stub; `maybeSingle` serves the connection row, the rest the count. */
function builder(opts: { maybeSingle?: unknown; count?: number } = {}) {
  const b: Record<string, unknown> = {};
  for (const k of ["select", "eq", "is"]) b[k] = () => b;
  b.maybeSingle = async () => opts.maybeSingle ?? { data: null };
  // The count query awaits the builder itself rather than a terminal method.
  b.then = (resolve: (v: unknown) => unknown) => resolve({ count: opts.count ?? 0 });
  return b;
}

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "u1", role: "owner", email: "u@test" } });
});

describe("GET /api/meetings/calendar-status", () => {
  it("does not claim provider sync without a writable calendar", async () => {
    // A Gmail connection is not a calendar this app can write to. The flag is
    // the panel's only licence to stop disclaiming, so it stays false until a
    // connection AND a calendar the member can write to both resolve.
    from.mockReturnValue(builder({ maybeSingle: { data: { account_label: "ops@fund.test", status: "connected" } } }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).providerSyncAvailable).toBe(false);
  });

  it("reports a connected Google account with its label", async () => {
    from.mockReturnValue(builder({ maybeSingle: { data: { account_label: "ops@fund.test", status: "connected" } } }));
    const json = await (await GET()).json();
    expect(json).toMatchObject({ googleAccountConnected: true, googleAccountLabel: "ops@fund.test" });
  });

  it("treats a revoked connection as not connected, and withholds its label", async () => {
    from.mockReturnValue(builder({ maybeSingle: { data: { account_label: "old@fund.test", status: "revoked" } } }));
    const json = await (await GET()).json();
    expect(json.googleAccountConnected).toBe(false);
    expect(json.googleAccountLabel).toBeNull();
  });

  it("reports no connection when the org has never linked one", async () => {
    from.mockReturnValue(builder({ maybeSingle: { data: null } }));
    const json = await (await GET()).json();
    expect(json).toMatchObject({ googleAccountConnected: false, googleAccountLabel: null });
  });

  it("counts meetings flagged to sync, so the warning can be specific", async () => {
    from.mockReturnValue(builder({ maybeSingle: { data: null }, count: 4 }));
    expect((await (await GET()).json()).meetingsWithSyncEnabled).toBe(4);
  });

  it("requires an org context", async () => {
    authMock.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    expect((await GET()).status).toBe(401);
  });
});
