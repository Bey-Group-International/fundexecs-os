// Multi-factor authentication policy (TOTP).
//
// Pure rules, no I/O, so the gate can be tested without a browser or a
// Supabase project. The wiring lives in lib/auth.ts (state), lib/mfa.server.ts
// (redirects) and app/security/mfa + app/login/mfa (the screens).
//
// The rule is deliberately two separate questions:
//   1. Is a second factor REQUIRED of this person?  -> role-based (owner/admin)
//   2. Have they ENROLLED one?                      -> if so it must be used
// Anyone who has enrolled a factor is challenged, whatever their role. A member
// who opted in must not be able to skip the prompt just because the policy does
// not force them to have one.
import type { MemberRole } from "@/lib/supabase/database.types";

export type AssuranceLevel = "aal1" | "aal2";

/** Roles that must hold a second factor. They can read LP PII and approve LPs. */
export const MFA_REQUIRED_ROLES: readonly MemberRole[] = ["owner", "admin"];

export const MFA_CHALLENGE_PATH = "/login/mfa";
export const MFA_ENROLL_PATH = "/security/mfa";

export interface MfaFactorLike {
  id: string;
  factor_type?: string | null;
  status?: string | null;
}

export interface MfaState {
  /** At least one VERIFIED TOTP factor exists. An unfinished enrollment does not count. */
  enrolled: boolean;
  /** Session assurance level; null when unknown (treated as not satisfied). */
  level: AssuranceLevel | null;
  /** Policy demands a factor of this person. */
  required: boolean;
}

export type MfaGate = "ok" | "enroll" | "challenge";

/**
 * Kill switch. Enforcement is ON unless MFA_ENFORCEMENT=off, so a missing
 * variable fails safe. "off" exists for an emergency (e.g. the auth provider's
 * MFA API is down and admins are locked out), not for routine use. It only
 * relaxes the role requirement; anyone who has enrolled is still challenged.
 */
export function mfaEnforcementEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.MFA_ENFORCEMENT?.trim().toLowerCase() !== "off";
}

export function mfaRequiredForRole(
  role: MemberRole | null | undefined,
  enforcement: boolean = mfaEnforcementEnabled(),
): boolean {
  return enforcement && role != null && MFA_REQUIRED_ROLES.includes(role);
}

export function verifiedTotpFactors<T extends MfaFactorLike>(
  factors: readonly T[] | null | undefined,
): T[] {
  return (factors ?? []).filter(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
}

export function buildMfaState(input: {
  role: MemberRole | null | undefined;
  factors: readonly MfaFactorLike[] | null | undefined;
  level: AssuranceLevel | null;
  enforcement?: boolean;
}): MfaState {
  return {
    enrolled: verifiedTotpFactors(input.factors).length > 0,
    level: input.level,
    required: mfaRequiredForRole(input.role, input.enforcement),
  };
}

/**
 * What the signed-in person must do before reaching the app.
 * Unknown assurance level with an enrolled factor fails closed (challenge).
 */
export function mfaGate(state: MfaState): MfaGate {
  if (state.enrolled) return state.level === "aal2" ? "ok" : "challenge";
  return state.required ? "enroll" : "ok";
}

/** TOTP codes are exactly six digits; spaces people type or paste are tolerated. */
export function normalizeTotpCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}
