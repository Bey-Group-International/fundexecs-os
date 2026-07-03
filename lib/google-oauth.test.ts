// Coverage for the Google OAuth flow (audit P2 — per-org Gmail identity).
// The security-bearing pieces are what matter: the signed state must survive
// a round trip and reject tampering/expiry (OAuth CSRF), the auth URL must
// request offline+consent (or Google never issues a refresh token), and the
// runtime resolver must cache minted access tokens and fail to null (callers
// fall through their credential chain) rather than throwing.

const getOrgSecret = jest.fn();
jest.mock("@/lib/org-secrets", () => ({
  getOrgSecret: (...a: unknown[]) => getOrgSecret(...a),
}));

import {
  buildGoogleAuthUrl,
  clearGoogleTokenCache,
  createOAuthState,
  exchangeCodeForTokens,
  getGoogleAccessToken,
  googleOAuthConfigured,
  refreshAccessToken,
  verifyOAuthState,
} from "./google-oauth";

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  clearGoogleTokenCache();
  process.env = {
    ...ORIGINAL_ENV,
    FUNDEXECS_VAULT_KEY: "0".repeat(64),
    GOOGLE_OAUTH_CLIENT_ID: "client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("signed OAuth state", () => {
  it("round-trips and binds org + user", () => {
    const raw = createOAuthState({ orgId: "org-1", userId: "user-1" });
    expect(verifyOAuthState(raw)).toEqual({ orgId: "org-1", userId: "user-1" });
  });

  it("rejects tampering, expiry, and garbage", () => {
    const raw = createOAuthState({ orgId: "org-1", userId: "user-1" });
    expect(verifyOAuthState(raw.slice(0, -2) + "xx")).toBeNull();
    const stale = createOAuthState({ orgId: "org-1", userId: "user-1" }, Date.now() - 11 * 60 * 1000);
    expect(verifyOAuthState(stale)).toBeNull();
    expect(verifyOAuthState("not-a-state")).toBeNull();
  });

  it("fails closed without the vault key", () => {
    const raw = createOAuthState({ orgId: "org-1", userId: "user-1" });
    delete process.env.FUNDEXECS_VAULT_KEY;
    expect(verifyOAuthState(raw)).toBeNull();
  });
});

describe("buildGoogleAuthUrl", () => {
  it("requests offline access with forced consent and the gmail.send scope", () => {
    const url = new URL(buildGoogleAuthUrl("st-1", "https://app.test/cb"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
  });
});

describe("token exchange and refresh", () => {
  it("parses tokens and the connected address from the id_token", async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "gp@fund.test" })).toString("base64url")}.y`;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", id_token: idToken }),
    });
    const tokens = await exchangeCodeForTokens("code-1", "https://app.test/cb");
    expect(tokens).toEqual({ accessToken: "at", refreshToken: "rt", email: "gp@fund.test" });

    const body = String((fetchMock.mock.calls[0][1] as { body: URLSearchParams }).body);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("client_secret=client-secret");
  });

  it("throws on failure so callers surface it, not swallow it", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    await expect(exchangeCodeForTokens("c", "https://app.test/cb")).rejects.toThrow(/400/);
    await expect(refreshAccessToken("rt")).rejects.toThrow(/400/);
  });
});

describe("getGoogleAccessToken", () => {
  it("mints from the vaulted refresh token and caches per org", async () => {
    getOrgSecret.mockResolvedValue("rt-1");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at-1", expires_in: 3600 }),
    });
    expect(await getGoogleAccessToken("org-1")).toBe("at-1");
    expect(await getGoogleAccessToken("org-1")).toBe("at-1");
    // Second call served from cache — one vault read, one refresh.
    expect(getOrgSecret).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null (never throws) when unconnected, unconfigured, or failing", async () => {
    getOrgSecret.mockResolvedValue(null);
    expect(await getGoogleAccessToken("org-1")).toBeNull();

    getOrgSecret.mockResolvedValue("rt-1");
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    expect(await getGoogleAccessToken("org-2")).toBeNull();

    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(googleOAuthConfigured()).toBe(false);
    expect(await getGoogleAccessToken("org-3")).toBeNull();
  });
});
