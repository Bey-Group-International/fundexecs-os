// The calendar-status endpoint exists to keep the connection panel honest, so
// these tests are mostly about what it must NOT claim.
const authMock = jest.fn();
const from = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: () => ({ from }) }));

import { GET } from "./route";

/** Chainable stub; `maybeSingle` serves the row, awaiting it serves the count. */
function builder(opts: { maybeSingle?: unknown; count?: number } = {}) {
  const b: Record<string, unknown> = {};
  for (const k of ["select", "eq", "is"]) b[k] = () => b;
  b.maybeSingle = async () => opts.maybeSingle ?? { data: null };
  // The count query awaits the builder itself rather than a terminal method.
  b.then = (resolve: (v: unknown) => unknown) => resolve({ count: opts.count ?? 0 });
  return b;
}

/**
 * Dispatch by table. The mailbox and the member's calendar grant are different
 * connections — reporting one as the other is the confusion this endpoint
 * spent a long time embodying, so the stub has to be able to tell them apart.
 *
 * Note what is NOT stubbed: writeTargetFor runs against this same client and
 * needs `.in`/`.order`/`.limit`, which the builder does not have. It therefore
 * throws into its own `.catch(() => null)`, which is exactly the "no writable
 * calendar" case every test below but one is asserting.
 */
function tables(opts: { gmail?: unknown; calendar?: unknown; count?: number } = {}) {
  return (table: string) => {
    if (table === "integration_connections") return builder({ maybeSingle: { data: opts.gmail ?? null } });
    if (table === "google_calendar_connections") return builder({ maybeSingle: { data: opts.calendar ?? null } });
    return builder({ count: opts.count ?? 0 });
  };
}

const GMAIL = { account_label: "ops@fund.test", status: "connected" };

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "u1", role: "owner", email: "u@test" } });
});

describe("GET /api/meetings/calendar-status", () => {
  it("does not claim provider sync without a writable calendar", async () => {
    // A Gmail connection is not a calendar this app can write to. The flag is
    // the panel's only licence to stop disclaiming, so it stays false until a
    // connection AND a calendar the member can write to both resolve.
    from.mockImplementation(tables({ gmail: GMAIL }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).providerSyncAvailable).toBe(false);
  });

  it("reports a connected Google account with its label", async () => {
    from.mockImplementation(tables({ gmail: GMAIL }));
    const json = await (await GET()).json();
    expect(json).toMatchObject({ googleAccountConnected: true, googleAccountLabel: "ops@fund.test" });
  });

  it("treats a revoked connection as not connected, and withholds its label", async () => {
    from.mockImplementation(tables({ gmail: { account_label: "old@fund.test", status: "revoked" } }));
    const json = await (await GET()).json();
    expect(json.googleAccountConnected).toBe(false);
    expect(json.googleAccountLabel).toBeNull();
  });

  it("reports no connection when the org has never linked one", async () => {
    from.mockImplementation(tables());
    const json = await (await GET()).json();
    expect(json).toMatchObject({ googleAccountConnected: false, googleAccountLabel: null });
  });

  it("counts meetings flagged to sync, so the warning can be specific", async () => {
    from.mockImplementation(tables({ count: 4 }));
    expect((await (await GET()).json()).meetingsWithSyncEnabled).toBe(4);
  });

  // The panel says different things to "you have not connected a calendar" and
  // "your calendar is read-only". Before this field it called both of them not
  // connected, which was wrong to the member's face in the second case.
  it("reports the member's own calendar grant separately from the mailbox", async () => {
    from.mockImplementation(tables({ gmail: GMAIL, calendar: { id: "conn-1" } }));
    const json = await (await GET()).json();
    expect(json.calendarConnected).toBe(true);
    // Connected, but with no calendar it can write to.
    expect(json.providerSyncAvailable).toBe(false);
  });

  it("does not read an org mailbox as the member's calendar", async () => {
    from.mockImplementation(tables({ gmail: GMAIL }));
    const json = await (await GET()).json();
    expect(json.googleAccountConnected).toBe(true);
    expect(json.calendarConnected).toBe(false);
  });

  it("requires an org context", async () => {
    authMock.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    expect((await GET()).status).toBe(401);
  });
});
