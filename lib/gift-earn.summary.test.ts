// Coverage for how the Invite page's summary is fetched. The numbers it shows
// are money, so the point here is that the cheaper query shape returns the same
// answers: earnings summed in the database over only the referral reasons, and
// org names resolved in one round trip rather than one per level.

type Call = { table: string; columns: string; filters: Record<string, unknown> };
const calls: Call[] = [];

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: jest.fn(),
  createServerClient: jest.fn(),
}));
jest.mock("@/lib/credits", () => ({ grantCredits: jest.fn() }));

import { getReferralSummary } from "@/lib/gift-earn";
import { createServiceClient } from "@/lib/supabase/server";

type Edge = { referred_organization_id: string; status: string; created_at: string };

// Referral edges keyed by referrer id, plus org names and a ledger the sum is
// taken over. The double applies `.in("reason", …)` itself, so a test can prove
// the filter reached the database rather than the app.
function makeServiceClient(world: {
  edges: Record<string, Edge[]>;
  names: Record<string, string>;
  ledger: { amount: number; reason: string }[];
}) {
  return {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let columns = "";
      const b: Record<string, unknown> = {
        select: (c: string) => {
          columns = c;
          return b;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return b;
        },
        in: (col: string, vals: unknown) => {
          filters[col] = vals;
          return b;
        },
        single: async () => {
          calls.push({ table, columns, filters });
          const reasons = (filters["reason"] as string[]) ?? null;
          const rows = world.ledger.filter((e) => !reasons || reasons.includes(e.reason));
          return { data: { sum: rows.reduce((t, e) => t + e.amount, 0) }, error: null };
        },
        then: (onFulfilled: (v: unknown) => unknown) => {
          calls.push({ table, columns, filters });
          let data: unknown = [];
          if (table === "referrals") {
            const frontier = (filters["referrer_organization_id"] as string[]) ?? [];
            data = frontier.flatMap((id) => world.edges[id] ?? []);
          } else if (table === "organizations") {
            const ids = (filters["id"] as string[]) ?? [];
            data = ids.map((id) => ({ id, name: world.names[id] }));
          }
          return Promise.resolve({ data, error: null }).then(onFulfilled);
        },
      };
      return b;
    },
  };
}

const edge = (id: string): Edge => ({
  referred_organization_id: id,
  status: "subscribed",
  created_at: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
});

describe("getReferralSummary", () => {
  const world = {
    edges: { "org-a": [edge("org-b"), edge("org-c")], "org-b": [edge("org-d")] },
    names: { "org-b": "Beta Partners", "org-c": "Gamma Capital", "org-d": "Delta Fund" },
    ledger: [
      { amount: 500, reason: "referral_welcome" },
      { amount: 1000, reason: "referral_direct" },
      { amount: 250, reason: "referral_override" },
      { amount: 2000, reason: "referral_milestone" },
      // Not referral earnings — must not reach the total.
      { amount: 50_000, reason: "plan_grant" },
      { amount: -300, reason: "spend" },
    ],
  };

  it("walks the downline and names every firm in it", async () => {
    (createServiceClient as jest.Mock).mockReturnValue(makeServiceClient(world));

    const summary = await getReferralSummary("org-a");

    expect(summary.directCount).toBe(2);
    expect(summary.totalDownline).toBe(3);
    expect(summary.levelCounts).toEqual({ 1: 2, 2: 1 });
    expect(summary.downline.map((d) => [d.name, d.level])).toEqual([
      ["Beta Partners", 1],
      ["Gamma Capital", 1],
      ["Delta Fund", 2],
    ]);
  });

  it("sums only referral earnings, and does the filtering in the database", async () => {
    (createServiceClient as jest.Mock).mockReturnValue(makeServiceClient(world));

    const summary = await getReferralSummary("org-a");

    // 500 + 1000 + 250 + 2000 — the plan grant and the spend are excluded.
    expect(summary.earnedTotal).toBe(3750);

    const ledgerCall = calls.find((c) => c.table === "credit_ledger");
    expect(ledgerCall?.columns).toBe("amount.sum()");
    expect(ledgerCall?.filters["reason"]).toEqual([
      "referral_direct",
      "referral_override",
      "referral_milestone",
      "referral_welcome",
    ]);
  });

  it("resolves names in a single query rather than one per level", async () => {
    (createServiceClient as jest.Mock).mockReturnValue(makeServiceClient(world));

    await getReferralSummary("org-a");

    const orgCalls = calls.filter((c) => c.table === "organizations");
    expect(orgCalls).toHaveLength(1);
    expect(orgCalls[0].filters["id"]).toEqual(["org-b", "org-c", "org-d"]);
  });

  it("asks for nothing at all when the org has no referrals", async () => {
    (createServiceClient as jest.Mock).mockReturnValue(
      makeServiceClient({ edges: {}, names: {}, ledger: [] }),
    );

    const summary = await getReferralSummary("org-lonely");

    expect(summary.totalDownline).toBe(0);
    expect(summary.earnedTotal).toBe(0);
    // An empty id list must never become a query.
    expect(calls.filter((c) => c.table === "organizations")).toHaveLength(0);
  });

  it("degrades to an empty summary rather than breaking the page", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    (createServiceClient as jest.Mock).mockImplementation(() => {
      throw new Error("service role not configured");
    });

    expect(await getReferralSummary("org-a")).toEqual({
      directCount: 0,
      totalDownline: 0,
      levelCounts: {},
      downline: [],
      earnedTotal: 0,
    });
    err.mockRestore();
  });
});
