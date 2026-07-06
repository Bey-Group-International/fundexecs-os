// Tests for the MCP-standard OAuth discovery + dynamic client registration —
// the no-manual-credentials Carta path. Pure parsers + injected transports.
import {
  metadataProbeUrls,
  parseAuthServerMetadata,
  parseProtectedResourceMetadata,
  discoverCartaEndpoints,
  registerDynamicClient,
  clearCartaEndpointCache,
  type MetadataTransport,
} from "./discovery.server";

describe("metadataProbeUrls", () => {
  it("probes protected-resource, auth-server, then OIDC on the origin", () => {
    expect(metadataProbeUrls("https://mcp.carta.example/v1/mcp")).toEqual([
      "https://mcp.carta.example/.well-known/oauth-protected-resource",
      "https://mcp.carta.example/.well-known/oauth-authorization-server",
      "https://mcp.carta.example/.well-known/openid-configuration",
    ]);
  });
});

describe("parseAuthServerMetadata", () => {
  it("extracts the endpoints", () => {
    expect(
      parseAuthServerMetadata({
        issuer: "https://auth.carta.example",
        authorization_endpoint: "https://auth.carta.example/authorize",
        token_endpoint: "https://auth.carta.example/token",
        registration_endpoint: "https://auth.carta.example/register",
        scopes_supported: ["read:funds", 42, "read:cap_table"],
      }),
    ).toEqual({
      issuer: "https://auth.carta.example",
      authorizationEndpoint: "https://auth.carta.example/authorize",
      tokenEndpoint: "https://auth.carta.example/token",
      registrationEndpoint: "https://auth.carta.example/register",
      scopesSupported: ["read:funds", "read:cap_table"],
    });
  });

  it("returns null when required endpoints are missing", () => {
    expect(parseAuthServerMetadata({ authorization_endpoint: "x" })).toBeNull();
    expect(parseAuthServerMetadata(null)).toBeNull();
  });
});

describe("parseProtectedResourceMetadata", () => {
  it("returns the first authorization server", () => {
    expect(
      parseProtectedResourceMetadata({ authorization_servers: ["https://auth.carta.example"] }),
    ).toBe("https://auth.carta.example");
  });
  it("returns null when absent", () => {
    expect(parseProtectedResourceMetadata({})).toBeNull();
  });
});

describe("discoverCartaEndpoints", () => {
  beforeEach(() => clearCartaEndpointCache());

  it("follows protected-resource metadata → auth-server metadata", async () => {
    const transport: MetadataTransport = async (url) => {
      if (url.endsWith("/.well-known/oauth-protected-resource")) {
        return { status: 200, json: { authorization_servers: ["https://auth.carta.example"] } };
      }
      if (url === "https://auth.carta.example/.well-known/oauth-authorization-server") {
        return {
          status: 200,
          json: {
            authorization_endpoint: "https://auth.carta.example/authorize",
            token_endpoint: "https://auth.carta.example/token",
            registration_endpoint: "https://auth.carta.example/register",
          },
        };
      }
      return { status: 404, json: null };
    };
    const ep = await discoverCartaEndpoints("https://mcp.carta.example", transport);
    expect(ep).toMatchObject({
      authorizationEndpoint: "https://auth.carta.example/authorize",
      tokenEndpoint: "https://auth.carta.example/token",
      registrationEndpoint: "https://auth.carta.example/register",
    });
  });

  it("falls back to auth-server metadata on the MCP origin directly", async () => {
    const transport: MetadataTransport = async (url) => {
      if (url === "https://mcp.carta.example/.well-known/oauth-authorization-server") {
        return {
          status: 200,
          json: {
            authorization_endpoint: "https://mcp.carta.example/authorize",
            token_endpoint: "https://mcp.carta.example/token",
          },
        };
      }
      return { status: 404, json: null };
    };
    const ep = await discoverCartaEndpoints("https://mcp.carta.example", transport);
    expect(ep?.tokenEndpoint).toBe("https://mcp.carta.example/token");
  });

  it("caches by MCP URL (second call makes no requests)", async () => {
    let calls = 0;
    const transport: MetadataTransport = async (url) => {
      calls += 1;
      if (url.endsWith("/oauth-authorization-server")) {
        return { status: 200, json: { authorization_endpoint: "a", token_endpoint: "t" } };
      }
      return { status: 404, json: null };
    };
    await discoverCartaEndpoints("https://mcp.carta.example", transport);
    const before = calls;
    await discoverCartaEndpoints("https://mcp.carta.example", transport);
    expect(calls).toBe(before); // served from cache
  });

  it("returns null (never throws) when nothing resolves", async () => {
    const transport: MetadataTransport = async () => ({ status: 404, json: null });
    expect(await discoverCartaEndpoints("https://mcp.carta.example", transport)).toBeNull();
  });
});

describe("registerDynamicClient", () => {
  it("POSTs client metadata and returns the issued client", async () => {
    let seen: { url: string; body?: string } | null = null;
    const transport: MetadataTransport = async (url, init) => {
      seen = { url, body: init?.body };
      return { status: 201, json: { client_id: "dyn-123", client_secret: "sh" } };
    };
    const client = await registerDynamicClient(
      "https://auth.carta.example/register",
      "https://app.example/api/oauth/carta/callback",
      transport,
    );
    expect(client).toEqual({ clientId: "dyn-123", clientSecret: "sh" });
    const body = JSON.parse(seen!.body ?? "{}");
    expect(body.redirect_uris).toEqual(["https://app.example/api/oauth/carta/callback"]);
    expect(body.grant_types).toContain("authorization_code");
  });

  it("supports a public client (no secret)", async () => {
    const transport: MetadataTransport = async () => ({ status: 200, json: { client_id: "pub-1" } });
    expect(await registerDynamicClient("https://a/register", "https://app/cb", transport)).toEqual({
      clientId: "pub-1",
      clientSecret: undefined,
    });
  });

  it("returns null on failure (never throws)", async () => {
    const transport: MetadataTransport = async () => ({ status: 400, json: { error: "invalid" } });
    expect(await registerDynamicClient("https://a/register", "https://app/cb", transport)).toBeNull();
  });
});
