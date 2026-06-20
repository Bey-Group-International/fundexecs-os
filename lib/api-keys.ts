// FundExecs-issued API credentials. This module owns the credential *shape* and
// the verification path; the Settings server actions (api-keys-actions.ts) own
// persistence. Kept free of `server-only` and of cookie-bound clients so the
// pure helpers (generation, hashing, masking) stay unit-testable — only
// verifyApiKey/requireApiKey reach the database, and only ever from the server.
import { createHash, randomBytes } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import type { ApiKeyMode } from "@/lib/supabase/database.types";

export const API_KEY_MODES: readonly ApiKeyMode[] = ["test", "live"] as const;

// fxpk_… is the publishable (public) key; fxsk_… is the secret. The mode is
// encoded in the prefix so a credential is self-describing at a glance — the
// same convention Stripe popularized (pk_live_…, sk_test_…).
const PUBLISHABLE_PREFIX = "fxpk";
const SECRET_PREFIX = "fxsk";

function randomToken(): string {
  // 24 bytes → 48 hex chars. High enough entropy that a fast hash (SHA-256) is
  // the correct choice for storage — there is nothing to brute-force.
  return randomBytes(24).toString("hex");
}

export interface GeneratedKeyPair {
  publishableKey: string;
  secretKey: string;
}

/** Mint a fresh publishable/secret pair for the given mode. */
export function generateKeyPair(mode: ApiKeyMode): GeneratedKeyPair {
  return {
    publishableKey: `${PUBLISHABLE_PREFIX}_${mode}_${randomToken()}`,
    secretKey: `${SECRET_PREFIX}_${mode}_${randomToken()}`,
  };
}

/** One-way SHA-256 hex digest of a secret — what we actually persist. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret.trim()).digest("hex");
}

/** The non-secret leading namespace of a key, e.g. "fxsk_live". */
export function secretPrefix(secret: string): string {
  return secret.split("_").slice(0, 2).join("_");
}

/** Last 4 chars of a secret, kept purely for a recognizable masked display. */
export function secretLast4(secret: string): string {
  return secret.slice(-4);
}

/** Render a stored secret for the UI: "fxsk_live_••••••••1234". */
export function maskedSecret(prefix: string, last4: string): string {
  return `${prefix}_${"•".repeat(8)}${last4}`;
}

/** True for strings shaped like one of our secret keys (cheap pre-filter). */
export function looksLikeSecretKey(value: string): boolean {
  return /^fxsk_(test|live)_[0-9a-f]{48}$/.test(value.trim());
}

export interface VerifiedKey {
  keyId: string;
  orgId: string;
  mode: ApiKeyMode;
}

/**
 * Resolve a presented secret key to its org, or null if it is malformed,
 * unknown, or revoked. Uses the service-role client (the caller is an external
 * API consumer with no Supabase session) and best-effort stamps last_used_at.
 * Returns null — never throws — when the service role is unconfigured, so the
 * route layer can map the absence cleanly.
 */
export async function verifyApiKey(
  secret: string | null | undefined,
): Promise<VerifiedKey | null> {
  if (!secret || !looksLikeSecretKey(secret)) return null;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("api_keys")
    .select("id, organization_id, mode")
    .eq("secret_hash", hashSecret(secret))
    .is("revoked_at", null)
    .maybeSingle();

  if (!data) return null;

  // Best-effort usage stamp — never block verification on the write.
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    keyId: data.id,
    orgId: data.organization_id,
    mode: data.mode as ApiKeyMode,
  };
}

/** Pull the presented secret from a request: `Authorization: Bearer …` or `x-api-key`. */
export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return request.headers.get("x-api-key")?.trim() ?? null;
}

/**
 * Gate an inbound API route on a valid secret key. Mirrors requireOrgContext's
 * tagged-result shape so handlers can map the reason to an HTTP status.
 */
export async function requireApiKey(
  request: Request,
): Promise<
  | { ok: true; key: VerifiedKey }
  | { ok: false; status: 401 | 503; error: string }
> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      status: 503,
      error: "API key verification is unavailable (service role not configured)",
    };
  }
  const key = await verifyApiKey(extractApiKey(request));
  if (!key) return { ok: false, status: 401, error: "Invalid or missing API key" };
  return { ok: true, key };
}
