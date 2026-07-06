// lib/integrations/carta/oauth.server.ts
// Carta Public API — OAuth 2.0 credential plumbing for the proactive layer's
// Carta source. Two grant types, one runtime resolver:
//
//   1. client_credentials — server-to-server against the firm's OWN Carta
//      account (no user in the loop). The autonomous-sweep default.
//   2. authorization_code + refresh — interactive consent (for plans that only
//      expose third-party/OIDC access), fortified with PKCE (S256), an
//      HMAC-signed + expiring state, and refresh-token rotation. The refresh
//      token lives encrypted in the vault; access tokens are minted on demand.
//
// getCartaAccessToken(orgId) resolves a live access token by either path,
// cached per-org with a safety margin. Every failure degrades to null so the
// Carta source falls back to modeled data — never a fake token, never a throw
// into a sweep. Mirrors lib/google-oauth.ts; the auth-code half adds PKCE.
//
// Account-specific values a human supplies from Carta's API-platform onboarding:
//   CARTA_TOKEN_URL, CARTA_AUTHORIZE_URL, CARTA_OAUTH_SCOPES, and the per-org
//   CARTA_CLIENT_ID / CARTA_CLIENT_SECRET (Settings vault). The grants are
//   standard OAuth 2.0.

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getOrgSecret } from "@/lib/org-secrets";
import { createServiceClient } from "@/lib/supabase/server";
import { encryptSecret, vaultConfigured } from "@/lib/vault";

// ── Config keys ────────────────────────────────────────────────────────────────
export const CARTA_TOKEN_URL_ENV = "CARTA_TOKEN_URL";
export const CARTA_AUTHORIZE_URL_ENV = "CARTA_AUTHORIZE_URL";
export const CARTA_OAUTH_SCOPES_ENV = "CARTA_OAUTH_SCOPES";
/** org_secrets.provider keys for the per-org Carta OAuth material. */
export const CARTA_CLIENT_ID_SECRET = "CARTA_CLIENT_ID";
export const CARTA_CLIENT_SECRET_SECRET = "CARTA_CLIENT_SECRET";
export const CARTA_REFRESH_TOKEN_SECRET = "CARTA_REFRESH_TOKEN";

/** The OAuth callback path (the redirect_uri is `${appUrl}${this}`). */
export const CARTA_CALLBACK_PATH = "/api/oauth/carta/callback";
/** httpOnly cookie carrying the PKCE verifier from /start to /callback. */
export const CARTA_PKCE_COOKIE = "carta_pkce";

const EXPIRY_MARGIN_SEC = 60;
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_FETCH_TIMEOUT_MS = 10_000;

export interface CartaClientCreds {
  clientId: string;
  clientSecret: string;
}

export interface CartaOAuthConfig extends CartaClientCreds {
  tokenUrl: string;
  scope?: string;
}

export interface MintedToken {
  accessToken: string;
  expiresInSec: number;
  /** Present when the provider rotated the refresh token on this exchange. */
  refreshToken?: string | null;
}

/** Pluggable transport for tests — POST the token request, resolve the JSON. */
export type TokenTransport = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ status: number; json: unknown }>;

// ── PKCE (RFC 7636, S256) ───────────────────────────────────────────────────────

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** base64url of a SHA-256 digest — the S256 code_challenge. Pure. */
export function pkceChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** A fresh PKCE verifier (43–128 chars) + its S256 challenge. */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url"); // 64 url-safe chars
  return { verifier, challenge: pkceChallengeFromVerifier(verifier) };
}

// ── HMAC-signed state (OAuth CSRF) ──────────────────────────────────────────────

const STATE_KDF_SALT = "carta-oauth-state-v1";
let cachedSigningKey: { raw: string; key: Buffer } | null = null;

/**
 * The HMAC signing key, derived from the vault secret via scrypt (a memory-hard
 * KDF, exactly as lib/vault.ts derives the encryption key). Deriving rather than
 * using the raw secret directly strengthens the construction against offline
 * attack and keeps the signing-secret handling consistent with the vault. The
 * derived key is cached per process so the KDF cost is paid once. Null (fail
 * closed) when no vault secret is configured — a missing secret can never yield
 * a forgeable state.
 */
function signingKey(): Buffer | null {
  const raw = process.env.FUNDEXECS_VAULT_KEY;
  if (!raw) return null;
  if (cachedSigningKey?.raw !== raw) {
    cachedSigningKey = { raw, key: scryptSync(raw, STATE_KDF_SALT, 32) };
  }
  return cachedSigningKey.key;
}

function sign(payload: string): string {
  const key = signingKey();
  if (!key) return "";
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export interface CartaOAuthState {
  orgId: string;
  userId: string;
}

/** Mint the signed state carried through Carta's redirect. */
export function createCartaOAuthState(state: CartaOAuthState, nowMs: number = Date.now()): string {
  const payload = [
    state.orgId,
    state.userId,
    String(nowMs + STATE_TTL_MS),
    randomBytes(8).toString("base64url"),
  ].join(".");
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/** Verify + unpack a callback's state; null on tamper, expiry, or bad shape. */
export function verifyCartaOAuthState(raw: string, nowMs: number = Date.now()): CartaOAuthState | null {
  if (!signingKey()) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  let payload: string;
  try {
    payload = Buffer.from(raw.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = Buffer.from(sign(payload), "utf8");
  const provided = Buffer.from(raw.slice(dot + 1), "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  const [orgId, userId, expiresAt] = payload.split(".");
  if (!orgId || !userId || !expiresAt) return null;
  if (!Number.isFinite(Number(expiresAt)) || Number(expiresAt) < nowMs) return null;
  return { orgId, userId };
}

// ── Authorization URL ───────────────────────────────────────────────────────────

/** True when the interactive auth-code flow can start (endpoints + vault). */
export function cartaAuthConfigured(): boolean {
  return Boolean(
    process.env[CARTA_AUTHORIZE_URL_ENV] &&
      process.env[CARTA_TOKEN_URL_ENV] &&
      vaultConfigured(),
  );
}

/** Build the Carta consent URL with PKCE. Pure (reads only the authorize URL). */
export function buildCartaAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
  authorizeUrl?: string;
}): string {
  const base = args.authorizeUrl ?? process.env[CARTA_AUTHORIZE_URL_ENV] ?? "";
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });
  if (args.scope) params.set("scope", args.scope);
  return `${base}?${params.toString()}`;
}

// ── Token request bodies ────────────────────────────────────────────────────────

/** form-encoded client_credentials grant. Pure + tested. */
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
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
};

function readTokenBody(json: unknown): MintedToken {
  const body = (json ?? {}) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!body.access_token) throw new Error("Carta token response had no access_token");
  return {
    accessToken: body.access_token,
    expiresInSec: body.expires_in ?? 3600,
    refreshToken: body.refresh_token ?? null,
  };
}

// ── Grant executions ────────────────────────────────────────────────────────────

/** client_credentials grant. Throws on non-2xx / missing token. */
export async function mintClientCredentialsToken(
  config: CartaOAuthConfig,
  transport: TokenTransport = defaultTransport,
): Promise<MintedToken> {
  const { status, json } = await transport(
    config.tokenUrl,
    buildTokenRequestBody(config.clientId, config.clientSecret, config.scope),
    FORM_HEADERS,
  );
  if (status < 200 || status >= 300) throw new Error(`Carta token endpoint HTTP ${status}`);
  return readTokenBody(json);
}

/** authorization_code exchange (with PKCE verifier). Throws on failure. */
export async function exchangeCartaCode(
  args: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    tokenUrl: string;
    creds: CartaClientCreds;
  },
  transport: TokenTransport = defaultTransport,
): Promise<MintedToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.creds.clientId,
    client_secret: args.creds.clientSecret,
    code_verifier: args.codeVerifier,
  }).toString();
  const { status, json } = await transport(args.tokenUrl, body, FORM_HEADERS);
  if (status < 200 || status >= 300) throw new Error(`Carta code exchange HTTP ${status}`);
  return readTokenBody(json);
}

/** refresh_token grant. Returns a rotated refresh token when the provider sends one. */
export async function refreshCartaAccessToken(
  args: { refreshToken: string; tokenUrl: string; creds: CartaClientCreds; scope?: string },
  transport: TokenTransport = defaultTransport,
): Promise<MintedToken> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.creds.clientId,
    client_secret: args.creds.clientSecret,
  });
  if (args.scope) params.set("scope", args.scope);
  const { status, json } = await transport(args.tokenUrl, params.toString(), FORM_HEADERS);
  if (status < 200 || status >= 300) throw new Error(`Carta token refresh HTTP ${status}`);
  return readTokenBody(json);
}

// ── Credential resolution ───────────────────────────────────────────────────────

/** Resolve per-org client creds (vault → env). Null when either half is absent. */
export async function resolveClientCreds(orgId?: string): Promise<CartaClientCreds | null> {
  let clientId: string | null | undefined;
  let clientSecret: string | null | undefined;
  if (orgId) {
    try {
      clientId = await getOrgSecret(orgId, CARTA_CLIENT_ID_SECRET);
      clientSecret = await getOrgSecret(orgId, CARTA_CLIENT_SECRET_SECRET);
    } catch {
      // vault miss → env fallback
    }
  }
  clientId = clientId ?? process.env.CARTA_CLIENT_ID;
  clientSecret = clientSecret ?? process.env.CARTA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// ── Runtime resolver ────────────────────────────────────────────────────────────

// Per-org access-token cache (module-level, like the Google cache). A warm
// serverless instance reuses a minted token until it nears expiry; a cold start
// re-mints. Keyed by org so tenants never share a token.
const tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

/**
 * Persist a rotated refresh token (best-effort, service-role, org-scoped). Carta
 * may return a new refresh token on refresh; dropping it would kill the
 * connection at the old token's expiry. Never throws.
 */
async function persistRotatedRefreshToken(orgId: string, refreshToken: string): Promise<void> {
  if (!vaultConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const enc = encryptSecret(refreshToken);
    const supabase = createServiceClient();
    await supabase.from("org_secrets").upsert(
      {
        organization_id: orgId,
        provider: CARTA_REFRESH_TOKEN_SECRET,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        auth_tag: enc.authTag,
        last4: refreshToken.slice(-4),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider" },
    );
  } catch {
    // best-effort — a persistence miss just means we re-refresh next cold start
  }
}

export interface AccessTokenOpts {
  transport?: TokenTransport;
  nowMs?: number;
  /** Force the client_credentials path with an explicit config (tests). */
  config?: CartaOAuthConfig;
  /** Provide the refresh token directly to skip the vault read. */
  refreshToken?: string | null;
  /** Persist a rotated refresh token when the refresh path yields one. */
  persistRotation?: boolean;
}

/**
 * A live Carta access token for the org (cached until near expiry), or null when
 * unconfigured / on any failure. Path precedence: an explicit config (tests) →
 * a stored refresh token (interactive consent) → client_credentials. Never throws.
 */
export async function getCartaAccessToken(
  orgId?: string,
  opts: AccessTokenOpts = {},
): Promise<string | null> {
  const now = opts.nowMs ?? Date.now();
  const cacheKey = orgId ?? "__env__";

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > now) return cached.token;

  const scope = process.env[CARTA_OAUTH_SCOPES_ENV] || undefined;

  const store = (minted: MintedToken) => {
    tokenCache.set(cacheKey, {
      token: minted.accessToken,
      expiresAtMs: now + Math.max(0, minted.expiresInSec - EXPIRY_MARGIN_SEC) * 1000,
    });
    return minted.accessToken;
  };

  try {
    // 1) Explicit client-credentials config (unit tests, or a caller that
    //    resolved config itself).
    if (opts.config) {
      return store(await mintClientCredentialsToken(opts.config, opts.transport));
    }

    const tokenUrl = process.env[CARTA_TOKEN_URL_ENV];
    if (!tokenUrl) return null;
    const creds = await resolveClientCreds(orgId);
    if (!creds) return null;

    // 2) Refresh-token path (interactive consent) — preferred when present.
    let refreshToken = opts.refreshToken;
    if (refreshToken === undefined && orgId) {
      try {
        refreshToken = await getOrgSecret(orgId, CARTA_REFRESH_TOKEN_SECRET);
      } catch {
        refreshToken = null;
      }
    }
    if (refreshToken) {
      const minted = await refreshCartaAccessToken({ refreshToken, tokenUrl, creds, scope }, opts.transport);
      if (opts.persistRotation !== false && orgId && minted.refreshToken && minted.refreshToken !== refreshToken) {
        await persistRotatedRefreshToken(orgId, minted.refreshToken);
      }
      return store(minted);
    }

    // 3) client_credentials fallback.
    return store(await mintClientCredentialsToken({ ...creds, tokenUrl, scope }, opts.transport));
  } catch {
    return null;
  }
}

/** Test/ops helper — drop a cached token so the next call re-mints. */
export function clearCartaTokenCache(orgId?: string): void {
  if (orgId) tokenCache.delete(orgId);
  else tokenCache.clear();
}

/** Alias for reconnect/disconnect flows (parallels invalidateGoogleTokenCache). */
export function invalidateCartaTokenCache(orgId: string): void {
  tokenCache.delete(orgId);
}
