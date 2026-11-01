"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getAppUrlFromHeaders } from "@/lib/integrations/adapters/app-url";
import { DEFAULT_POST_AUTH_PATH, safeNextPathOrNull } from "@/lib/safe-next-path";
import { getSessionContext } from "@/lib/auth";
import { recordMfaAudit } from "@/lib/mfa-audit.server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateRecoveryCodes, hashRecoveryCode } from "@/lib/mfa-recovery";
import { MFA_CHALLENGE_PATH, MFA_ENROLL_PATH, normalizeTotpCode, verifiedTotpFactors } from "@/lib/mfa";

const NOT_CONFIGURED = "Authentication is not configured for this environment.";
const BAD_CODE = "Enter the 6-digit code from your authenticator app.";

export type EnrollStart =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

async function client() {
  if (!hasSupabaseServerEnv()) return null;
  return createServerClient();
}

async function destination(raw: FormDataEntryValue | string | null | undefined) {
  const base = getAppUrlFromHeaders(await headers());
  return safeNextPathOrNull(typeof raw === "string" ? raw : null, base) ?? DEFAULT_POST_AUTH_PATH;
}

/**
 * Begin enrolling an authenticator app. Any half-finished enrollment from an
 * earlier attempt is removed first: it never counted as a factor, and leaving
 * it would make the provider refuse a second enrollment with the same name.
 */
export async function startTotpEnrollment(): Promise<EnrollStart> {
  const supabase = await client();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED };
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { ok: false, error: "Sign in again to continue." };

  for (const f of user.user.factors ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    issuer: "FundExecs OS",
  });
  if (error || !data) return { ok: false, error: error?.message ?? "Could not start enrollment." };
  await audit(user.user.id, "mfa.enroll_started", { factor_type: "totp" });
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Finish enrollment: prove the app produces valid codes. Upgrades the session to aal2. */
export async function confirmTotpEnrollment(factorId: string, rawCode: string): Promise<ActionResult> {
  const code = normalizeTotpCode(rawCode);
  if (!code) return { ok: false, error: BAD_CODE };
  const supabase = await client();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ok: false, error: "That code didn't match. Check your app and try again." };
  const { data: u } = await supabase.auth.getUser();
  if (u.user) await audit(u.user.id, "mfa.enrolled", { factor_type: "totp" });
  return { ok: true };
}

type AuditAction = Parameters<typeof recordMfaAudit>[0]["action"];
type AuditDetail = Parameters<typeof recordMfaAudit>[0]["detail"];

/** Record a security event for this user; the org (if any) lets its admins see it. */
async function audit(userId: string, action: AuditAction, detail?: AuditDetail) {
  const ctx = await getSessionContext().catch(() => null);
  await recordMfaAudit({ userId, organizationId: ctx?.orgId ?? null, action, detail });
}

export type RecoveryCodesResult = { ok: true; codes: string[] } | { ok: false; error: string };

/**
 * Issue a fresh set of ten recovery codes, replacing any earlier set. Requires a
 * session that has passed the second factor (aal2): the codes are a way around
 * it, so they may only be minted by someone who has just proved it. The codes are
 * returned once; only keyed hashes are stored.
 */
export async function createRecoveryCodes(): Promise<RecoveryCodesResult> {
  const supabase = await client();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Sign in again to continue." };
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return { ok: false, error: "Verify with your authenticator app first." };

  const codes = generateRecoveryCodes();
  const db = createServiceClient() as any;
  const del = await db.from("mfa_recovery_codes").delete().eq("user_id", auth.user.id);
  if (del.error) return { ok: false, error: "Could not save recovery codes. Try again." };
  const ins = await db
    .from("mfa_recovery_codes")
    .insert(await Promise.all(codes.map(async (c) => ({ user_id: auth.user.id, code_hash: await hashRecoveryCode(c.replace("-", "")) }))));
  if (ins.error) return { ok: false, error: "Could not save recovery codes. Try again." };
  await audit(auth.user.id, "mfa.recovery_codes_generated", { codes: codes.length });
  return { ok: true, codes };
}

/** Answer the sign-in challenge with a code from an enrolled factor. */
export async function verifyLoginChallenge(formData: FormData) {
  const next = await destination(formData.get("next"));
  const back = (msg: string) =>
    redirect(`${MFA_CHALLENGE_PATH}?error=${encodeURIComponent(msg)}&next=${encodeURIComponent(next)}`);

  const code = normalizeTotpCode(formData.get("code"));
  if (!code) back(BAD_CODE);

  const supabase = await client();
  if (!supabase) redirect(`/login?error=${encodeURIComponent(NOT_CONFIGURED)}`);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const factor = verifiedTotpFactors(auth.user.factors)[0];
  if (!factor) redirect(MFA_ENROLL_PATH);

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code! });
  // Same message for every failure: do not say whether the code was stale,
  // wrong or rate limited beyond what the provider already exposes to the person.
  if (error) {
    await audit(auth.user.id, "mfa.challenge_failed");
    back("That code didn't match. Check your app and try again.");
  }
  await audit(auth.user.id, "mfa.challenge_ok");
  redirect(next);
}

/** Remove a factor. The provider only allows this from an aal2 session. */
export async function removeFactor(formData: FormData) {
  const factorId = String(formData.get("factorId") ?? "");
  const supabase = await client();
  if (!supabase) redirect(`${MFA_ENROLL_PATH}?error=${encodeURIComponent(NOT_CONFIGURED)}`);
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) redirect(`${MFA_ENROLL_PATH}?error=${encodeURIComponent(error.message)}`);
  if (auth.user) await audit(auth.user.id, "mfa.factor_removed", { factor_type: "totp" });
  redirect(MFA_ENROLL_PATH);
}
