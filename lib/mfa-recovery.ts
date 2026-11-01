// MFA recovery codes: pure rules (no I/O).
//
// A recovery code lets someone who lost their authenticator app back in. Using
// one does NOT satisfy the second factor: it removes their authenticator so they
// must enrol a new one. So a code is only ever as strong as the password session
// it is presented from, and it is single use.
//
// Codes are 10 characters from an unambiguous alphabet (no 0/O/1/I/L), shown as
// xxxxx-xxxxx: 31^10 ≈ 2^49.5 combinations. Only a keyed hash is stored.
import { randomInt, scrypt } from "crypto";

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_MAX_FAILURES = 5;
export const RECOVERY_LOCK_WINDOW_MS = 15 * 60 * 1000;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 characters
const LENGTH = 10;

export function generateRecoveryCode(): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const set = new Set<string>();
  while (set.size < count) set.add(generateRecoveryCode());
  return [...set];
}

/** Canonical form: upper case, only alphabet characters; null if it cannot be a code. */
export function normalizeRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.toUpperCase().replace(/[\s-]/g, "");
  if (cleaned.length !== LENGTH) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}

/**
 * Slow, keyed hash (scrypt, N=2^14). The salt includes MFA_RECOVERY_SECRET (else the
 * service-role key), so a stolen table alone cannot be attacked offline, and an
 * attacker who also has the key still pays scrypt's cost for each of ~2^49 guesses.
 * Deterministic on purpose: the stored hash is looked up by equality.
 */
export function hashRecoveryCode(normalized: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  const key = env.MFA_RECOVERY_SECRET?.trim() || env.SUPABASE_SERVICE_ROLE_KEY || "";
  return new Promise((resolve, reject) =>
    scrypt(normalized, `fx-mfa-recovery:${key}`, 32, { N: 16384, r: 8, p: 1 }, (err, out) =>
      err ? reject(err) : resolve(out.toString("hex")),
    ),
  );
}

/** True when the failures inside the window have reached the limit. */
export function recoveryLocked(failureTimesMs: readonly number[], nowMs: number): boolean {
  return failureTimesMs.filter((t) => nowMs - t < RECOVERY_LOCK_WINDOW_MS).length >= RECOVERY_MAX_FAILURES;
}
