// FundExecs-issued API credentials — the credential *shape*: generation,
// hashing, masking, and request parsing. Deliberately dependency-light (only
// node `crypto`): no Supabase client and no `next/headers`, so it is safe to
// import from client components (e.g. ApiKeys.tsx uses maskedSecret) and stays
// unit-testable. The database-backed verifier lives in api-keys-verify.ts.
import { createHmac, randomBytes } from "crypto";
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

// Keyed HMAC-SHA256, not a bare hash. Secret keys are 192-bit random tokens, so
// brute-forcing the input is already infeasible and a slow KDF (bcrypt/scrypt)
// would buy nothing — but those use a per-row salt, which is incompatible with
// the O(1) "look up the row by its hash" verification path. A keyed HMAC keeps
// the digest deterministic (so lookup works) while making a leaked database
// useless to an attacker who lacks the server-side pepper. The pepper is
// optional (FUNDEXECS_API_KEY_PEPPER); unset, it degrades to an empty key,
// which is still an HMAC and still not a plain password hash.
function pepper(): string {
  return process.env.FUNDEXECS_API_KEY_PEPPER ?? "";
}

/** Deterministic keyed digest of a secret — what we actually persist. */
export function hashSecret(secret: string): string {
  return createHmac("sha256", pepper()).update(secret.trim()).digest("hex");
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

/** Pull the presented secret from a request: `Authorization: Bearer …` or `x-api-key`. */
export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return request.headers.get("x-api-key")?.trim() ?? null;
}
