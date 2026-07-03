// lib/google-oauth.ts
// The Google OAuth authorization-code + refresh flow — the credential plumbing
// the integration blueprint called for (per-org Gmail identity, refresh token
// in the vault). Three pieces:
//
//   1. Signed state: the /start route mints an HMAC-signed state binding
//      (orgId, userId, expiry); the callback verifies it so a forged or
//      replayed callback can never attach Google credentials to another org
//      (classic OAuth CSRF). Signed with FUNDEXECS_VAULT_KEY — the same secret
//      the resulting refresh token is encrypted under, so configuring the
//      vault is the single prerequisite.
//   2. Code exchange + refresh: exchangeCodeForTokens at connect time (with
//      access_type=offline + prompt=consent so Google issues a refresh
//      token); refreshAccessToken thereafter.
//   3. getGoogleAccessToken(orgId): the runtime resolver — reads the org's
//      refresh token from the vault, mints a short-lived access token, and
//      caches it in-process with a safety margin. This replaces the static
//      ~1-hour GMAIL_ACCESS_TOKEN as the way Gmail sends acquire credentials.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getOrgSecret } from "@/lib/org-secrets";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// gmail.send is the only Gmail scope the OS needs (outbound identity); openid
// email lets the callback label the connection with the connected address.
const SCOPES = "openid email https://www.googleapis.com/auth/gmail.send";

const STATE_TTL_MS = 10 * 60 * 1000;

/** The vault key the refresh token is stored under (org_secrets.provider). */
export const GOOGLE_REFRESH_TOKEN_KEY = "GOOGLE_REFRESH_TOKEN";

export function googleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

// ── Signed state ──────────────────────────────────────────────────────────────

function stateSecret(): string {
  // The vault key must exist anyway to store the refresh token; reusing it
  // avoids a second deployment secret. Fail closed when absent.
  return process.env.FUNDEXECS_VAULT_KEY ?? "";
}

function sign(payload: string): string {
  return createHmac("sha256", stateSecret()).update(payload).digest("base64url");
}

export interface OAuthState {
  orgId: string;
  userId: string;
}

/** Mint the signed state carried through Google's redirect. */
export function createOAuthState(state: OAuthState, nowMs: number = Date.now()): string {
  const payload = [
    state.orgId,
    state.userId,
    String(nowMs + STATE_TTL_MS),
    randomBytes(8).toString("base64url"),
  ].join(".");
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/** Verify + unpack a callback's state; null on tamper, expiry, or bad shape. */
export function verifyOAuthState(raw: string, nowMs: number = Date.now()): OAuthState | null {
  if (!stateSecret()) return null;
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

// ── Authorization URL ─────────────────────────────────────────────────────────

export function buildGoogleAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    // offline + consent is what makes Google return a refresh token.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// ── Token exchange / refresh ──────────────────────────────────────────────────

export interface GoogleTokens {
  refreshToken: string | null;
  accessToken: string;
  // The connected Google account's email, from the id_token — display label
  // only (the token came straight from Google over TLS, not a third party).
  email: string | null;
}

function parseIdTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  };
  if (!body.access_token) throw new Error("google token exchange returned no access token");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    email: parseIdTokenEmail(body.id_token),
  };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`google token refresh failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("google token refresh returned no access token");
  return { accessToken: body.access_token, expiresInSec: body.expires_in ?? 3600 };
}

// ── Runtime resolver ──────────────────────────────────────────────────────────

// Access tokens live ~1h; cache per org with a safety margin so a burst of
// sends mints one token, not one per email. In-process only — a cold start
// just refreshes again.
const SAFETY_MARGIN_MS = 5 * 60 * 1000;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * A live Gmail access token for the org, minted from its vaulted refresh
 * token. Null when the org hasn't connected Google or OAuth isn't configured —
 * callers fall through to their existing credential chain.
 */
export async function getGoogleAccessToken(orgId: string): Promise<string | null> {
  if (!googleOAuthConfigured()) return null;

  const cached = tokenCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  let refreshToken: string | null;
  try {
    refreshToken = await getOrgSecret(orgId, GOOGLE_REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
  if (!refreshToken) return null;

  try {
    const { accessToken, expiresInSec } = await refreshAccessToken(refreshToken);
    tokenCache.set(orgId, {
      token: accessToken,
      expiresAt: Date.now() + expiresInSec * 1000 - SAFETY_MARGIN_MS,
    });
    return accessToken;
  } catch (err) {
    console.error(`[google-oauth] token refresh failed for org ${orgId}:`, err);
    return null;
  }
}

/** Test hook — clears the in-process access-token cache. */
export function clearGoogleTokenCache(): void {
  tokenCache.clear();
}
