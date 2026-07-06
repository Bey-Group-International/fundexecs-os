// lib/integrations/carta/discovery.server.ts
// MCP-standard OAuth onboarding for Carta with NO manually-issued credentials.
//
// This is the path Carta's "Carta MCP" connected app uses: instead of a human
// pasting a client_id/secret (which Carta's UI doesn't expose), the app
//   1. DISCOVERS Carta's OAuth endpoints from the MCP server URL
//      (RFC 9728 protected-resource-metadata → RFC 8414 authorization-server-
//      metadata / OIDC discovery), and
//   2. DYNAMICALLY REGISTERS itself (RFC 7591) to get a client_id (+ secret).
// The operator then only consents once (the auth-code + PKCE flow already in
// oauth.server.ts). See the MCP authorization spec.
//
// Pure parsing + an injectable transport so the well-known/registration logic is
// unit-testable offline. Never throws; returns null so callers degrade to the
// manual-credentials path or the modeled fallback. The single human input is the
// Carta MCP server base URL (CARTA_MCP_URL).

/** GET/POST transport: returns the HTTP status and parsed JSON (null if none). */
export type MetadataTransport = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json: unknown }>;

export interface CartaOAuthEndpoints {
  issuer?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
}

export interface DcrClient {
  clientId: string;
  clientSecret?: string;
}

async function defaultTransport(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: init?.body,
    signal: AbortSignal.timeout(10_000),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** Candidate well-known metadata URLs to probe, in order. Pure. */
export function metadataProbeUrls(mcpUrl: string): string[] {
  const o = origin(mcpUrl);
  return [
    `${o}/.well-known/oauth-protected-resource`,
    `${o}/.well-known/oauth-authorization-server`,
    `${o}/.well-known/openid-configuration`,
  ];
}

/** Map an authorization-server metadata document to our endpoint shape. Pure. */
export function parseAuthServerMetadata(doc: unknown): CartaOAuthEndpoints | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  const authorizationEndpoint = typeof d.authorization_endpoint === "string" ? d.authorization_endpoint : "";
  const tokenEndpoint = typeof d.token_endpoint === "string" ? d.token_endpoint : "";
  if (!authorizationEndpoint || !tokenEndpoint) return null;
  return {
    issuer: typeof d.issuer === "string" ? d.issuer : undefined,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: typeof d.registration_endpoint === "string" ? d.registration_endpoint : undefined,
    scopesSupported: Array.isArray(d.scopes_supported)
      ? (d.scopes_supported as unknown[]).filter((s): s is string => typeof s === "string")
      : undefined,
  };
}

/** Extract the first authorization server URL from protected-resource metadata. Pure. */
export function parseProtectedResourceMetadata(doc: unknown): string | null {
  if (!doc || typeof doc !== "object") return null;
  const servers = (doc as Record<string, unknown>).authorization_servers;
  if (Array.isArray(servers) && typeof servers[0] === "string") return servers[0];
  return null;
}

// Discovered endpoints are stable for a given MCP URL — cache per process.
const endpointCache = new Map<string, CartaOAuthEndpoints>();

/**
 * Discover Carta's OAuth endpoints from the MCP server URL. Tries protected-
 * resource metadata first (which points at the auth server), then auth-server /
 * OIDC metadata directly. Returns null when nothing resolves. Never throws.
 */
export async function discoverCartaEndpoints(
  mcpUrl: string,
  transport: MetadataTransport = defaultTransport,
): Promise<CartaOAuthEndpoints | null> {
  if (!mcpUrl) return null;
  const cached = endpointCache.get(mcpUrl);
  if (cached) return cached;

  const [protectedResourceUrl, authServerUrl, oidcUrl] = metadataProbeUrls(mcpUrl);

  const tryFetch = async (url: string): Promise<unknown | null> => {
    try {
      const { status, json } = await transport(url);
      return status >= 200 && status < 300 ? json : null;
    } catch {
      return null;
    }
  };

  // 1) Protected-resource metadata → auth server base → its metadata.
  const pr = await tryFetch(protectedResourceUrl);
  const authServerBase = pr ? parseProtectedResourceMetadata(pr) : null;
  if (authServerBase) {
    const meta =
      (await tryFetch(`${origin(authServerBase)}/.well-known/oauth-authorization-server`)) ??
      (await tryFetch(`${origin(authServerBase)}/.well-known/openid-configuration`));
    const parsed = meta ? parseAuthServerMetadata(meta) : null;
    if (parsed) {
      endpointCache.set(mcpUrl, parsed);
      return parsed;
    }
  }

  // 2) Auth-server / OIDC metadata on the MCP origin directly.
  const direct = (await tryFetch(authServerUrl)) ?? (await tryFetch(oidcUrl));
  const parsedDirect = direct ? parseAuthServerMetadata(direct) : null;
  if (parsedDirect) {
    endpointCache.set(mcpUrl, parsedDirect);
    return parsedDirect;
  }

  return null;
}

/**
 * Dynamically register this app as an OAuth client (RFC 7591) and return the
 * issued client_id (+ secret if the server is confidential). Returns null on any
 * failure. Never throws.
 */
export async function registerDynamicClient(
  registrationEndpoint: string,
  redirectUri: string,
  transport: MetadataTransport = defaultTransport,
): Promise<DcrClient | null> {
  if (!registrationEndpoint) return null;
  try {
    const { status, json } = await transport(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: "FundExecs OS",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
        application_type: "web",
      }),
    });
    if (status < 200 || status >= 300) return null;
    const d = (json ?? {}) as { client_id?: string; client_secret?: string };
    if (!d.client_id) return null;
    return { clientId: d.client_id, clientSecret: d.client_secret };
  } catch {
    return null;
  }
}

/** Test/ops helper — drop cached endpoint discovery. */
export function clearCartaEndpointCache(mcpUrl?: string): void {
  if (mcpUrl) endpointCache.delete(mcpUrl);
  else endpointCache.clear();
}
