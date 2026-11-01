"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getAppUrlFromHeaders } from "@/lib/integrations/adapters/app-url";
import { DEFAULT_POST_AUTH_PATH, safeNextPathOrNull } from "@/lib/safe-next-path";
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
  return { ok: true };
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
  if (error) back("That code didn't match. Check your app and try again.");
  redirect(next);
}

/** Remove a factor. The provider only allows this from an aal2 session. */
export async function removeFactor(formData: FormData) {
  const factorId = String(formData.get("factorId") ?? "");
  const supabase = await client();
  if (!supabase) redirect(`${MFA_ENROLL_PATH}?error=${encodeURIComponent(NOT_CONFIGURED)}`);
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) redirect(`${MFA_ENROLL_PATH}?error=${encodeURIComponent(error.message)}`);
  redirect(MFA_ENROLL_PATH);
}
