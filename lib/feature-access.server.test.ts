import { requireFeatureAccess } from "@/lib/feature-access.server";
import { getSessionContext } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";

jest.mock("@/lib/auth", () => ({ getSessionContext: jest.fn() }));
jest.mock("@/lib/wallet", () => ({ getWallet: jest.fn() }));

const mockSession = getSessionContext as jest.Mock;
const mockWallet = getWallet as jest.Mock;

function session(email: string, emailConfirmed = true) {
  return { userId: "u1", email, emailConfirmed, orgId: "org1", role: "owner" };
}

describe("requireFeatureAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_EMAILS;
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
