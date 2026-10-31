"use server";

// LP onboarding portal actions for the steps AFTER approval: signing the
// subscription agreement and confirming the commitment. Public, token-gated (no
// user session), so every call goes through the service-role client.
//
// Two checks stand in front of them. The LP must have passed the emailed-code
// check (the token alone only names the onboarding), and the fund manager must
// have approved them: until then the wizard in wizard-actions.ts is the only
// thing the link can do. The previous self-ticked accreditation step is gone;
// accreditation is now the LP's statement in the wizard, confirmed by the fund
// manager's decision.
import { revalidatePath } from "next/cache";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { getLinkSession, hasLpPass } from "@/lib/lp-access.server";

async function getApprovedSession(token: string) {
  if (!hasSupabaseServiceEnv()) return null;
  const supabase = createServiceClient();
  const session = await getLinkSession(supabase, token);
  if (!session) return null;
  if (session.status === "complete") return null;
  if (session.review_state !== "approved") return null;
  if (!(await hasLpPass(session.id))) return null;
  return { supabase, session };
}

export async function signSubscriptionAction(
  token: string,
): Promise<{ ok: boolean } | { error: string }> {
  try {
    const ctx = await getApprovedSession(token);
    if (!ctx) return { error: "Invalid or expired link" };
    if (ctx.session.status !== "accreditation") return { error: "Not at subscription step" };

    const { error } = await ctx.supabase
      .from("lp_onboarding_sessions")
      .update({
        subscription_signed_at: new Date().toISOString(),
        status: "subscription",
      })
      .eq("id", ctx.session.id);
    if (error) {
      console.error("[lp-onboarding] session update failed:", error);
      return { error: "Failed to save. Please try again or refresh this link." };
    }

    revalidatePath(`/lp/${token}`);
    return { ok: true };
  } catch {
    return { error: "Failed to record signature" };
  }
}

export async function confirmCapitalCommitmentAction(
  token: string,
): Promise<{ ok: boolean } | { error: string }> {
  try {
    const ctx = await getApprovedSession(token);
    if (!ctx) return { error: "Invalid or expired link" };
    if (ctx.session.status !== "subscription") return { error: "Not at commitment step" };

    const { error } = await ctx.supabase
      .from("lp_onboarding_sessions")
      .update({ status: "committed" })
      .eq("id", ctx.session.id);
    if (error) {
      console.error("[lp-onboarding] session update failed:", error);
      return { error: "Failed to save. Please try again or refresh this link." };
    }

    revalidatePath(`/lp/${token}`);
    return { ok: true };
  } catch {
    return { error: "Failed to confirm commitment" };
  }
}
