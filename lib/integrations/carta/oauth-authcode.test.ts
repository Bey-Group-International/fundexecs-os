// Tests for the fortified interactive Carta OAuth: PKCE (S256), signed/expiring
// state, auth URL, code exchange, refresh + rotation, and the refresh-vs-
// client-credentials precedence in getCartaAccessToken.
import {
  pkceChallengeFromVerifier,
  createPkcePair,
  createCartaOAuthState,
  verifyCartaOAuthState,
  buildCartaAuthUrl,
  exchangeCartaCode,
  refreshCartaAccessToken,
  getCartaAccessToken,
  clearCartaTokenCache,
  type TokenTransport,
} from "./oauth.server";

const CREDS = { clientId: "cid", clientSecret: "csecret" };

describe("PKCE", () => {
  it("matches the RFC 7636 S256 test vector", () => {
    // Appendix B: verifier → challenge.
    expect(pkceChallengeFromVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("createPkcePair produces a verifier whose challenge is its S256 hash", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(pkceChallengeFromVerifier(verifier));
  });
});

describe("signed state", () => {
  const OLD = process.env.FUNDEXECS_VAULT_KEY;
  beforeAll(() => {
    process.env.FUNDEXECS_VAULT_KEY = "test-vault-key";
  });
  afterAll(() => {
    process.env.FUNDEXECS_VAULT_KEY = OLD;
  });

  it("round-trips org/user", () => {
    const s = createCartaOAuthState({ orgId: "o1", userId: "u1" });
    expect(verifyCartaOAuthState(s)).toEqual({ orgId: "o1", userId: "u1" });
  });

  it("rejects a tampered signature", () => {
    const s = createCartaOAuthState({ orgId: "o1", userId: "u1" });
    expect(verifyCartaOAuthState(s.slice(0, -2) + "xx")).toBeNull();
  });

  it("rejects an expired state", () => {
    const t0 = 1_000_000_000_000;
    const s = createCartaOAuthState({ orgId: "o1", userId: "u1" }, t0);
    expect(verifyCartaOAuthState(s, t0 + 11 * 60 * 1000)).toBeNull(); // TTL is 10m
  });

  it("fails closed when no vault key is set", () => {
    process.env.FUNDEXECS_VAULT_KEY = "";
    const s = createCartaOAuthState({ orgId: "o1", userId: "u1" });
    expect(verifyCartaOAuthState(s)).toBeNull();
    process.env.FUNDEXECS_VAULT_KEY = "test-vault-key";
  });
});

describe("buildCartaAuthUrl", () => {
  it("includes PKCE S256, state, and scope", () => {
    const url = new URL(
      buildCartaAuthUrl({
        clientId: "cid",
        redirectUri: "https://app.example/api/oauth/carta/callback",
        state: "st",
        codeChallenge: "chal",
        scope: "read:funds",
        authorizeUrl: "https://carta.example/authorize",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://carta.example/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toBe("read:funds");
  });
});

describe("exchangeCartaCode", () => {
  it("posts an authorization_code grant with the PKCE verifier", async () => {
    let body = "";
    const transport: TokenTransport = async (_url, b) => {
      body = b;
      return { status: 200, json: { access_token: "at", refresh_token: "rt", expires_in: 3600 } };
    };
    const t = await exchangeCartaCode(
      { code: "c", codeVerifier: "v", redirectUri: "https://app/cb", tokenUrl: "https://t", creds: CREDS },
      transport,
    );
    const p = new URLSearchParams(body);
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(p.get("code")).toBe("c");
    expect(p.get("code_verifier")).toBe("v");
    expect(t.refreshToken).toBe("rt");
  });

  it("throws on a non-2xx exchange", async () => {
    const transport: TokenTransport = async () => ({ status: 400, json: { error: "invalid_grant" } });
    await expect(
      exchangeCartaCode({ code: "c", codeVerifier: "v", redirectUri: "r", tokenUrl: "t", creds: CREDS }, transport),
    ).rejects.toThrow(/400/);
  });
});

describe("refreshCartaAccessToken", () => {
  it("posts a refresh_token grant and surfaces a rotated refresh token", async () => {
    let body = "";
    const transport: TokenTransport = async (_url, b) => {
      body = b;
      return { status: 200, json: { access_token: "at2", refresh_token: "rt2", expires_in: 1200 } };
    };
    const t = await refreshCartaAccessToken({ refreshToken: "rt1", tokenUrl: "https://t", creds: CREDS }, transport);
    expect(new URLSearchParams(body).get("grant_type")).toBe("refresh_token");
    expect(t).toMatchObject({ accessToken: "at2", refreshToken: "rt2", expiresInSec: 1200 });
  });
});

describe("getCartaAccessToken — path precedence", () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["CARTA_TOKEN_URL", "CARTA_CLIENT_ID", "CARTA_CLIENT_SECRET", "FUNDEXECS_VAULT_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  beforeEach(() => {
    clearCartaTokenCache();
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.CARTA_TOKEN_URL = "https://carta.example/token";
    process.env.CARTA_CLIENT_ID = "cid";
    process.env.CARTA_CLIENT_SECRET = "csecret";
    // No vault/service creds → no per-org secret reads or rotation writes.
    delete process.env.FUNDEXECS_VAULT_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  it("uses the refresh_token grant when a refresh token is supplied", async () => {
    let grant = "";
    const transport: TokenTransport = async (_url, b) => {
      grant = new URLSearchParams(b).get("grant_type") ?? "";
      return { status: 200, json: { access_token: "at", expires_in: 3600 } };
    };
    const t = await getCartaAccessToken("orgR", { transport, refreshToken: "rt", persistRotation: false });
    expect(t).toBe("at");
    expect(grant).toBe("refresh_token");
  });

  it("falls back to client_credentials when no refresh token exists", async () => {
    let grant = "";
    const transport: TokenTransport = async (_url, b) => {
      grant = new URLSearchParams(b).get("grant_type") ?? "";
      return { status: 200, json: { access_token: "at", expires_in: 3600 } };
    };
    const t = await getCartaAccessToken("orgC", { transport, refreshToken: null });
    expect(t).toBe("at");
    expect(grant).toBe("client_credentials");
  });

  it("returns null (never throws) when the token endpoint is unset", async () => {
    delete process.env.CARTA_TOKEN_URL;
    const t = await getCartaAccessToken("orgX", { transport: async () => ({ status: 200, json: {} }), refreshToken: null });
    expect(t).toBeNull();
  });
});
