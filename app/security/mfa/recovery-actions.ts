"use server";

import { redirect } from "next/navigation";
import { createServerClient, createServiceClient, hasSupabaseServerEnv, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { MFA_ENROLL_PATH, verifiedTotpFactors } from "@/lib/mfa";
import { hashRecoveryCode, normalizeRecoveryCode, recoveryLocked, RECOVERY_LOCK_WINDOW_MS } from "@/lib/mfa-recovery";
import { recentRecoveryFailures, recordMfaAudit } from "@/lib/mfa-audit.server";

const RECOVER_PATH = "/login/mfa/recover";
const back = (msg: string) => redirect(`${RECOVER_PATH}?error=${encodeURIComponent(msg)}`);

/**
 * Sign-in recovery for someone who lost their authenticator app. They must already
 * hold a password session (aal1). A valid, unused code is burned and their
 * authenticator is REMOVED; it never counts as the second factor. They are then
 * sent to enrol a new one. Five wrong codes in 15 minutes lock the attempts.
 */
export async function useRecoveryCode(formData: FormData) {
  if (!hasSupabaseServerEnv() || !hasSupabaseServiceEnv()) back("Recovery is not available in this environment.");
  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const userId = auth.user.id;
  const orgId = (await getSessionContext().catch(() => null))?.orgId ?? null;
  const record = (action: Parameters<typeof recordMfaAudit>[0]["action"], detail?: Parameters<typeof recordMfaAudit>[0]["detail"]) =>
    recordMfaAudit({ userId, organizationId: orgId, action, detail });

  const now = Date.now();
  if (recoveryLocked(await recentRecoveryFailures(userId, now - RECOVERY_LOCK_WINDOW_MS), now)) {
    await record("mfa.recovery_locked");
    back("Too many attempts. Try again in 15 minutes.");
  }

  const code = normalizeRecoveryCode(formData.get("code"));
  const db = createServiceClient() as any;
  let burned = false;
  if (code) {
    // One statement: only the row that is still unused matches, so a replay or a race loses.
    const { data } = await db
      .from("mfa_recovery_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("code_hash", await hashRecoveryCode(code))
      .is("used_at", null)
      .select("id");
    burned = Array.isArray(data) && data.length === 1;
  }
  if (!burned) {
    await record("mfa.recovery_failed");
    back("That recovery code isn't valid.");
  }

  let removed = 0;
  for (const f of verifiedTotpFactors(auth.user.factors)) {
    const { error } = await db.auth.admin.mfa.deleteFactor({ id: f.id, userId });
    if (!error) removed++;
  }
  await record("mfa.recovery_used", { factors_removed: removed });
  redirect(`${MFA_ENROLL_PATH}?error=${encodeURIComponent("Recovery code accepted. Set up a new authenticator app now.")}`);
}
