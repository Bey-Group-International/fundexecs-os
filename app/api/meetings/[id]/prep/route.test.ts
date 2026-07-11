// The prep endpoint gathers an org-scoped meeting + its linked deal/fund and
// returns a composed institutional prep prompt.

const authMock = jest.fn();
const from = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (...a: unknown[]) => from(...a) }),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };
const req = () => new NextRequest("http://localhost/api/meetings/m1/prep");

function rowBuilder(data: unknown) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, is: () => b,
    maybeSingle: async () => ({ data, error: null }),
  };
  return b;
}

function wire(tables: { live_meetings?: unknown; deals?: unknown; funds?: unknown }) {
  from.mockImplementation((table: string) => rowBuilder((tables as Record<string, unknown>)[table] ?? null));
}

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "u1", role: "owner", email: "u@test" } });
});

describe("GET /api/meetings/[id]/prep", () => {
  it("composes a prompt from meeting + deal + fund", async () => {
    wire({
      live_meetings: { title: "LP Update", objective: "Secure re-up", deal_id: "d1", related_fund_id: null, attendees: [{ name: "Jane", type: "external" }] },
      deals: { name: "Atlas Logistics", stage: "diligence", target_amount: 25_000_000, fund_id: "f1" },
      funds: { name: "Fund III", committed_capital: 250_000_000, currency: "USD" },
    });
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    expect(prompt).toContain("LP Update");
    expect(prompt).toContain("Secure re-up");
    expect(prompt).toContain("Atlas Logistics");
    expect(prompt).toContain("Fund III");
    expect(prompt).toContain("Jane");
  });

  it("falls back to the deal's fund when the meeting has no fund pointer", async () => {
    wire({
      live_meetings: { title: "Deal review", deal_id: "d1", related_fund_id: null, attendees: null },
      deals: { name: "Atlas", fund_id: "f1" },
      funds: { name: "Vehicle One" },
    });
    const res = await GET(req(), params);
    const { prompt } = await res.json();
    expect(prompt).toContain("Vehicle One");
  });

  it("works with a bare meeting (no linked records)", async () => {
    wire({ live_meetings: { title: "Quick sync", deal_id: null, related_fund_id: null, attendees: null } });
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const { prompt } = await res.json();
    expect(prompt).toContain("Quick sync");
    expect(prompt).not.toContain("FUND / VEHICLE");
  });

  it("404s when the meeting isn't in the caller's org", async () => {
    wire({ live_meetings: null });
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });

  it("propagates the auth failure status", async () => {
    authMock.mockResolvedValue({ ok: false, error: "No org", status: 403 });
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
  });
});
