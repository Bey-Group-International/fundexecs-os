// FundExecs-issued API credentials — the credential *shape*: generation,
// hashing, masking, and request parsing. Deliberately dependency-light (only
// node `crypto`): no Supabase client and no `next/headers`, so it is safe to
// import from client components (e.g. ApiKeys.tsx uses maskedSecret) and stays
// unit-testable. The database-backed verifier lives in api-keys-verify.ts.
import { randomBytes, scryptSync } from "crypto";
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

// scrypt — a deliberately slow KDF — over a fixed application salt (the pepper).
// Secret keys are 192-bit random tokens, so brute-forcing the input is already
// infeasible; the slow KDF is belt-and-suspenders and, crucially, satisfies the
// "use a strong password hash" static-analysis checks. A *fixed* salt is what
// keeps the digest deterministic, which the O(1) "look up the row by its hash"
// verification path requires (a per-row salt would force a full-table scan).
// The pepper is configurable via FUNDEXECS_API_KEY_PEPPER; the default keeps
// dev/test deterministic. Rotating it invalidates every issued secret key.
const PEPPER = process.env.FUNDEXECS_API_KEY_PEPPER ?? "fundexecs-os/api-keys/v1";

/** Deterministic slow-KDF digest of a secret — what we actually persist. */
export function hashSecret(secret: string): string {
  return scryptSync(secret.trim(), PEPPER, 32).toString("hex");
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

// ── Scopes ────────────────────────────────────────────────────────────────────
// The blast-radius contract for issued keys: each v1 route requires one scope,
// enforced in withApiKey (lib/api-v1.ts). Keys default to the full read set at
// issue time; narrowing is the issuer's choice.

export const API_SCOPES = [
  "read:organization",
  "read:deals",
  "read:investors",
  "read:funds",
  "write:deals",
  "write:investors",
  "events:subscribe",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  "read:organization": "Read organization profile",
  "read:deals": "Read deals",
  "read:investors": "Read investors",
  "read:funds": "Read funds",
  "write:deals": "Propose deals (approval-gated)",
  "write:investors": "Propose investors (approval-gated)",
  "events:subscribe": "Manage webhook subscriptions",
};

// What a key gets when the issuer picks nothing: the read set, exactly what
// pre-scopes keys had. Write scopes are opt-in only — growing the catalog must
// never silently widen keys issued through a form without the picker.
export const DEFAULT_API_SCOPES: readonly ApiScope[] = API_SCOPES.filter((s) =>
  s.startsWith("read:"),
);

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

export interface VerifiedKey {
  keyId: string;
  orgId: string;
  mode: ApiKeyMode;
  scopes: string[];
}

/** Pull the presented secret from a request: `Authorization: Bearer …` or `x-api-key`. */
export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return request.headers.get("x-api-key")?.trim() ?? null;
}
