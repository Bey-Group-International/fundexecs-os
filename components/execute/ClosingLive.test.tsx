/** @jest-environment node */
// Execute › Closing lists every LP's onboarding. The LP's email and link token
// are for owners and admins only (SOC 2 gap G-6): everyone else reads a view
// that has neither, and the token never reaches the page for anyone.
import { CLOSING_ADMIN_COLUMNS, CLOSING_MEMBER_COLUMNS, ClosingLive } from "./ClosingLive";

let role: string | null = "admin";
const reads: { table: string; columns?: string }[] = [];

jest.mock("@/lib/auth", () => ({
  getSessionContext: async () => ({ userId: "u1", orgId: "org-1", role }),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const rec: { table: string; columns?: string } = { table };
      reads.push(rec);
      const result = () => ({
        data:
          table === "lp_onboarding_sessions"
            ? [{ id: "s1", lp_name: "Calpers", lp_email: "ops@calpers.ca.gov", status: "pending", fund_id: null, commitment_amount: 5, expires_at: "2026-12-01" }]
            : table === "lp_onboarding_session_overview"
              ? [{ id: "s1", lp_name: "Calpers", status: "pending", fund_id: null, commitment_amount: 5, expires_at: "2026-12-01" }]
              : [],
        error: null,
      });
      const q: Record<string, unknown> = {
        select: (c: string) => ((rec.columns = c), q),
        eq: () => q,
        order: () => q,
        then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      };
      return q;
    },
  }),
}));

// The boards are client components; look at what they are given.
jest.mock("@/components/execute/LPOnboardingStatus", () => ({ LPOnboardingStatus: () => null }));
jest.mock("@/components/execute/ContractStatusBoard", () => ({ ContractStatusBoard: () => null }));

function sessionsGiven(el: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[][] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { props?: { sessions?: Record<string, unknown>[]; children?: unknown } };
    if (node.props?.sessions) found.push(node.props.sessions);
    const kids = node.props?.children;
    if (Array.isArray(kids)) kids.forEach(walk);
    else walk(kids);
  };
  walk(el);
  return found[0] ?? [];
}

beforeEach(() => {
  reads.length = 0;
  role = "admin";
});

describe("Execute › Closing LP sessions", () => {
  it.each(["owner", "admin"])("lets an %s see the LP's email, from the table", async (r) => {
    role = r;
    const sessions = sessionsGiven(await ClosingLive());
    expect(reads.find((x) => x.columns === CLOSING_ADMIN_COLUMNS)?.table).toBe("lp_onboarding_sessions");
    expect(sessions[0]).toMatchObject({ lpName: "Calpers", lpEmail: "ops@calpers.ca.gov" });
  });

  it.each(["member", "viewer"])("gives a %s the overview, without email", async (r) => {
    role = r;
    const sessions = sessionsGiven(await ClosingLive());
    expect(reads.find((x) => x.columns === CLOSING_MEMBER_COLUMNS)?.table).toBe("lp_onboarding_session_overview");
    expect(reads.some((x) => x.table === "lp_onboarding_sessions")).toBe(false);
    expect(sessions[0]).toMatchObject({ lpName: "Calpers" });
    expect(sessions[0]).not.toHaveProperty("lpEmail");
  });

  it("never selects or passes on the link token, for anyone", async () => {
    expect(CLOSING_ADMIN_COLUMNS).not.toMatch(/token/);
    expect(CLOSING_MEMBER_COLUMNS).not.toMatch(/token|email/);
    const sessions = sessionsGiven(await ClosingLive());
    expect(JSON.stringify(sessions)).not.toMatch(/token/i);
  });
});
