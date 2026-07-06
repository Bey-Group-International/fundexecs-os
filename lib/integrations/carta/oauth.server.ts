// lib/integrations/carta/oauth.server.ts
// Carta Public API — OAuth 2.0 client-credentials token minting (server-to-
// server). Carta's MCP endpoint verifies an OIDC token; for the DEPLOYED app's
// autonomous proactive sweep (no user present) the durable credential is a
// client_credentials grant against the firm's OWN Carta account — Carta issues a
// client_id + client_secret bound to a service user and a set of scopes, and we
// mint short-lived access tokens on demand. This mirrors lib/google-oauth.ts's
// per-org, cached token minting.
//
// Honesty discipline: with no client_id/secret (vault or env) or no
// CARTA_TOKEN_URL, getCartaAccessToken returns null and the Carta source
// degrades to its modeled fallback — never a fake token. Credentials resolve
// per-org from the vault (org_secrets), falling back to deploy-level env.
//
// The exact token endpoint URL and scope strings are account-specific values a
// human fills from Carta's API-platform onboarding (CARTA_TOKEN_URL,
// CARTA_OAUTH_SCOPES). The grant itself is standard OAuth 2.0.

import { getOrgSecret } from "@/lib/org-secrets";

export const CARTA_TOKEN_URL_ENV = "CARTA_TOKEN_URL";
export const CARTA_OAUTH_SCOPES_ENV = "CARTA_OAUTH_SCOPES";
/** org_secrets.provider keys for the per-org Carta OAuth client credentials. */
export const CARTA_CLIENT_ID_SECRET = "CARTA_CLIENT_ID";
export const CARTA_CLIENT_SECRET_SECRET = "CARTA_CLIENT_SECRET";

// Refresh a little before actual expiry so an in-flight call never uses a token
// that expires mid-request (mirrors the Google token cache's safety margin).
const EXPIRY_MARGIN_SEC = 60;

export interface CartaOAuthConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface MintedToken {
  accessToken: string;
  expiresInSec: number;
}

/** Pluggable transport for tests — POST the token request, resolve the JSON. */
export type TokenTransport = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ status: number; json: unknown }>;

/** Build the form-encoded client_credentials request body. Pure + tested. */
export function buildTokenRequestBody(clientId: string, clientSecret: string, scope?: string): string {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (scope) params.set("scope", scope);
  return params.toString();
}

async function defaultTransport(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { method: "POST", headers, body });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/**
 * Mint an access token via the client_credentials grant. Throws on a non-2xx or
 * a response missing access_token — the caller (getCartaAccessToken) catches and
 * degrades to null so a mint failure never breaks a sweep.
 */
export async function mintClientCredentialsToken(
  config: CartaOAuthConfig,
  transport: TokenTransport = defaultTransport,
): Promise<MintedToken> {
  const { status, json } = await transport(
    config.tokenUrl,
    buildTokenRequestBody(config.clientId, config.clientSecret, config.scope),
    {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
  );
  if (status < 200 || status >= 300) {
    throw new Error(`Carta token endpoint HTTP ${status}`);
  }
  const body = (json ?? {}) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Carta token response had no access_token");
  return { accessToken: body.access_token, expiresInSec: body.expires_in ?? 3600 };
}

// Per-org token cache (module-level, like the Google cache). A warm serverless
// instance reuses a minted token until it nears expiry; a cold start simply
// re-mints. Keyed by org so tenants never share a token.
const tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

/** Resolve the org's Carta OAuth config from the vault, falling back to env. */
async function resolveConfig(orgId?: string): Promise<CartaOAuthConfig | null> {
  const tokenUrl = process.env[CARTA_TOKEN_URL_ENV];
  if (!tokenUrl) return null;

  let clientId: string | null | undefined;
  let clientSecret: string | null | undefined;
  if (orgId) {
    try {
      clientId = await getOrgSecret(orgId, CARTA_CLIENT_ID_SECRET);
      clientSecret = await getOrgSecret(orgId, CARTA_CLIENT_SECRET_SECRET);
    } catch {
      // vault miss → fall back to env
    }
  }
  clientId = clientId ?? process.env.CARTA_CLIENT_ID;
  clientSecret = clientSecret ?? process.env.CARTA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return { tokenUrl, clientId, clientSecret, scope: process.env[CARTA_OAUTH_SCOPES_ENV] || undefined };
}

/**
 * Get a valid Carta access token for the org (cached until near expiry), or null
 * when unconfigured or on any mint failure. Never throws — the Carta source
 * falls back to modeled data on null. `opts` exposes seams for tests.
 */
export async function getCartaAccessToken(
  orgId?: string,
  opts: { transport?: TokenTransport; nowMs?: number; config?: CartaOAuthConfig } = {},
): Promise<string | null> {
  const now = opts.nowMs ?? Date.now();
  const cacheKey = orgId ?? "__env__";

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) return cached.token;

  const config = opts.config ?? (await resolveConfig(orgId));
  if (!config) return null;

  try {
    const minted = await mintClientCredentialsToken(config, opts.transport);
    tokenCache.set(cacheKey, {
      token: minted.accessToken,
      expiresAtMs: now + Math.max(0, minted.expiresInSec - EXPIRY_MARGIN_SEC) * 1000,
    });
    return minted.accessToken;
  } catch {
    return null;
  }
}

/** Test/ops helper — drop a cached token so the next call re-mints. */
export function clearCartaTokenCache(orgId?: string): void {
  if (orgId) tokenCache.delete(orgId);
  else tokenCache.clear();
}
