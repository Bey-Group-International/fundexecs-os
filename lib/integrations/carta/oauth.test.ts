// Tests for the Carta OAuth client-credentials minter — request shape, token
// caching by expiry, and the never-throws → null contract.
import {
  buildTokenRequestBody,
  mintClientCredentialsToken,
  getCartaAccessToken,
  clearCartaTokenCache,
  type TokenTransport,
  type CartaOAuthConfig,
} from "./oauth.server";

const cfg: CartaOAuthConfig = {
  tokenUrl: "https://carta.example/oauth/token",
  clientId: "cid",
  clientSecret: "csecret",
  scope: "read:funds read:cap_table",
};

function okTransport(token = "tok", expiresIn = 3600): TokenTransport {
  return async () => ({ status: 200, json: { access_token: token, expires_in: expiresIn } });
}

describe("buildTokenRequestBody", () => {
  it("encodes the client_credentials grant", () => {
    const p = new URLSearchParams(buildTokenRequestBody("cid", "csecret", "read:funds"));
    expect(p.get("grant_type")).toBe("client_credentials");
    expect(p.get("client_id")).toBe("cid");
    expect(p.get("client_secret")).toBe("csecret");
    expect(p.get("scope")).toBe("read:funds");
  });

  it("omits scope when not provided", () => {
    expect(new URLSearchParams(buildTokenRequestBody("cid", "csecret")).has("scope")).toBe(false);
  });
});

describe("mintClientCredentialsToken", () => {
  it("returns the token + lifetime on success", async () => {
    const t = await mintClientCredentialsToken(cfg, okTransport("abc", 1200));
    expect(t).toMatchObject({ accessToken: "abc", expiresInSec: 1200 });
  });

  it("sends form-encoded body to the token URL", async () => {
    let seen: { url: string; body: string; headers: Record<string, string> } | null = null;
    const transport: TokenTransport = async (url, body, headers) => {
      seen = { url, body, headers };
      return { status: 200, json: { access_token: "x" } };
    };
    await mintClientCredentialsToken(cfg, transport);
    expect(seen!.url).toBe(cfg.tokenUrl);
    expect(seen!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(seen!.body).toContain("grant_type=client_credentials");
  });

  it("throws on non-2xx", async () => {
    const transport: TokenTransport = async () => ({ status: 401, json: { error: "invalid_client" } });
    await expect(mintClientCredentialsToken(cfg, transport)).rejects.toThrow(/401/);
  });

  it("throws when access_token is missing", async () => {
    const transport: TokenTransport = async () => ({ status: 200, json: {} });
    await expect(mintClientCredentialsToken(cfg, transport)).rejects.toThrow(/no access_token/);
  });
});

describe("getCartaAccessToken — caching + graceful null", () => {
  beforeEach(() => clearCartaTokenCache());

  it("mints once and serves the cache until near expiry", async () => {
    let calls = 0;
    const transport: TokenTransport = async () => {
      calls += 1;
      return { status: 200, json: { access_token: `t${calls}`, expires_in: 3600 } };
    };
    const t0 = Date.now();
    const a = await getCartaAccessToken("org1", { transport, config: cfg, nowMs: t0 });
    const b = await getCartaAccessToken("org1", { transport, config: cfg, nowMs: t0 + 1000 });
    expect(a).toBe("t1");
    expect(b).toBe("t1"); // cached
    expect(calls).toBe(1);
  });

  it("re-mints after the token has (nearly) expired", async () => {
    let calls = 0;
    const transport: TokenTransport = async () => {
      calls += 1;
      return { status: 200, json: { access_token: `t${calls}`, expires_in: 100 } };
    };
    const t0 = Date.now();
    const a = await getCartaAccessToken("org1", { transport, config: cfg, nowMs: t0 });
    // 100s lifetime - 60s margin = valid ~40s; jump past that.
    const b = await getCartaAccessToken("org1", { transport, config: cfg, nowMs: t0 + 50_000 });
    expect(a).toBe("t1");
    expect(b).toBe("t2");
    expect(calls).toBe(2);
  });

  it("returns null (never throws) when minting fails", async () => {
    const transport: TokenTransport = async () => ({ status: 500, json: null });
    const t = await getCartaAccessToken("org1", { transport, config: cfg });
    expect(t).toBeNull();
  });

  it("returns null when unconfigured (no config resolvable)", async () => {
    // No config override and no env/vault creds in the test env.
    const t = await getCartaAccessToken(undefined, { transport: okTransport() });
    expect(t).toBeNull();
  });
});
