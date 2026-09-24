import { requireFeatureAccess } from "@/lib/feature-access.server";
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
