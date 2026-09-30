import { featureAccessForOrg, requireFeatureAccess } from "@/lib/feature-access.server";
import { getSessionContext } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";

jest.mock("@/lib/auth", () => ({ getSessionContext: jest.fn() }));
jest.mock("@/lib/wallet", () => ({ getWallet: jest.fn() }));

let orgCreatedAt: string | null = "2026-10-01T00:00:00.000Z";
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: orgCreatedAt ? { created_at: orgCreatedAt } : null }) }),
      }),
    }),
  }),
}));

const mockSession = getSessionContext as jest.Mock;
const mockWallet = getWallet as jest.Mock;

const ORIGINAL_ENV = process.env;

// A deployment that CAN sell a plan. Without this the gate opens for everyone
// (lib/feature-access: an unbuyable plan is no basis for a lock), which is
// correct behaviour and the opposite of what these cases are about.
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, STRIPE_SECRET_KEY: "sk_live_test_fixture" };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

function session(email: string, emailConfirmed = true) {
  return { userId: "u1", email, emailConfirmed, orgId: "org1", role: "owner" };
}

describe("requireFeatureAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_EMAILS;
    orgCreatedAt = "2026-10-01T00:00:00.000Z"; // after the paywall
  });

  it("401s without a session", async () => {
    mockSession.mockResolvedValue(null);
    await expect(requireFeatureAccess("run")).resolves.toEqual({
      ok: false,
      status: 401,
      error: "Not authenticated",
    });
  });

  it("402s a member whose org has no paid plan", async () => {
    mockSession.mockResolvedValue(session("alex@firm.com"));
    mockWallet.mockResolvedValue({ plan: "free" });
    const gate = await requireFeatureAccess("automations");
    expect(gate).toEqual({
      ok: false,
      status: 402,
      error: "Automations requires a paid plan. Choose a plan in Wallet to unlock it.",
    });
  });

  it("grandfathers a free org created before the paywall", async () => {
    orgCreatedAt = "2026-08-01T00:00:00.000Z";
    mockSession.mockResolvedValue(session("alex@firm.com"));
    mockWallet.mockResolvedValue({ plan: "free" });
    await expect(requireFeatureAccess("run")).resolves.toEqual({ ok: true });
  });

  it("stays locked when the org row can't be read", async () => {
    orgCreatedAt = null;
    mockSession.mockResolvedValue(session("alex@firm.com"));
    mockWallet.mockResolvedValue(null);
    expect((await requireFeatureAccess("run")).ok).toBe(false);
  });

  it("lets a paid-plan member through", async () => {
    mockSession.mockResolvedValue(session("alex@firm.com"));
    mockWallet.mockResolvedValue({ plan: "starter" });
    await expect(requireFeatureAccess("execute")).resolves.toEqual({ ok: true });
  });

  it("lets a confirmed @beygroupintl.com admin through without reading the wallet", async () => {
    mockSession.mockResolvedValue(session("ops@beygroupintl.com"));
    await expect(requireFeatureAccess("marketplace")).resolves.toEqual({ ok: true });
    expect(mockWallet).not.toHaveBeenCalled();
  });

  it("treats an unconfirmed @beygroupintl.com address as an ordinary member", async () => {
    mockSession.mockResolvedValue(session("ops@beygroupintl.com", false));
    mockWallet.mockResolvedValue(null);
    const gate = await requireFeatureAccess("office");
    expect(gate.ok).toBe(false);
  });
});

// The wiring, not just the decision: requireFeatureAccess must consult the
// environment, or the pure rule is unreachable from the place that enforces it.
describe("requireFeatureAccess when no plan can be bought", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_EMAILS;
    orgCreatedAt = "2026-10-01T00:00:00.000Z"; // after the paywall: normally locked
    // No card rail, no remittance — a deployment that cannot sell anything.
    process.env = { ...ORIGINAL_ENV };
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.FUNDEXECS_REMITTANCE_BANK_NAME;
    delete process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NAME;
    delete process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER;
  });

  it("lets a member act rather than 402ing them with no way to pay", async () => {
    mockSession.mockResolvedValue(session("alex@firm.com"));
    mockWallet.mockResolvedValue({ plan: "free" });
    await expect(requireFeatureAccess("automations")).resolves.toEqual({ ok: true });
  });

  it("still refuses a caller with no session", async () => {
    // The escape hatch is for stranded MEMBERS; it never admits an anonymous
    // caller, whatever the billing configuration.
    mockSession.mockResolvedValue(null);
    const gate = await requireFeatureAccess("run");
    expect(gate).toEqual({ ok: false, status: 401, error: "Not authenticated" });
  });

  it("closes again once remittance details exist", async () => {
    process.env.FUNDEXECS_REMITTANCE_BANK_NAME = "First Bank";
    process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NAME = "FundExecs LLC";
    process.env.FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER = "123456789";
    mockSession.mockResolvedValue(session("alex@firm.com"));
    mockWallet.mockResolvedValue({ plan: "free" });
    const gate = await requireFeatureAccess("automations");
    expect(gate.ok).toBe(false);
  });
});

describe("featureAccessForOrg (cron, no session)", () => {
  function service(opts: {
    user?: { email: string; email_confirmed_at: string | null } | null;
    plan?: string | null;
    createdAt?: string | null;
    fail?: "wallets" | "organizations" | "user";
  }) {
    const err = (what: string) => (opts.fail === what ? { message: "boom" } : null);
    const row = (data: unknown, error: unknown) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: error ? null : data, error }) }) }),
    });
    return {
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: err("user") ? null : (opts.user ?? null) }, error: err("user") }),
        },
      },
      from: (table: string) =>
        table === "wallets"
          ? row(opts.plan !== undefined ? { plan: opts.plan } : null, err("wallets"))
          : row(opts.createdAt ? { created_at: opts.createdAt } : null, err("organizations")),
    } as never;
  }

  beforeEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  it("locks a new org without a plan", async () => {
    const access = await featureAccessForOrg(
      service({ user: { email: "a@firm.com", email_confirmed_at: "x" }, plan: "free", createdAt: "2026-10-01T00:00:00Z" }),
      "org1",
      "u1",
    );
    expect(access.unlocked).toBe(false);
  });

  it("unlocks an org on a paid plan", async () => {
    const access = await featureAccessForOrg(service({ plan: "pro", createdAt: "2026-10-01T00:00:00Z" }), "org1", "u1");
    expect(access.unlocked).toBe(true);
  });

  it("grandfathers an org created before the paywall", async () => {
    const access = await featureAccessForOrg(service({ plan: null, createdAt: "2026-08-01T00:00:00Z" }), "org1", null);
    expect(access.grandfathered).toBe(true);
  });

  it("runs a confirmed admin's automation regardless of plan", async () => {
    const access = await featureAccessForOrg(
      service({ user: { email: "ops@beygroupintl.com", email_confirmed_at: "x" }, plan: null, createdAt: "2026-10-01T00:00:00Z" }),
      "org1",
      "u1",
    );
    expect(access.viaAdmin).toBe(true);
  });

  it("does not treat an unconfirmed admin-domain owner as an admin", async () => {
    const access = await featureAccessForOrg(
      service({ user: { email: "ops@beygroupintl.com", email_confirmed_at: null }, plan: null, createdAt: "2026-10-01T00:00:00Z" }),
      "org1",
      "u1",
    );
    expect(access.unlocked).toBe(false);
  });

  it.each(["wallets", "organizations", "user"] as const)("throws instead of locking when the %s read fails", async (fail) => {
    await expect(
      featureAccessForOrg(service({ plan: "pro", createdAt: "2026-10-01T00:00:00Z", fail }), "org1", "u1"),
    ).rejects.toThrow(/feature access/);
  });
});
