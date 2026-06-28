"use server";

// LP onboarding portal actions — public, token-gated (no user session required).
// All DB calls go through the service-role client since the LP is not authenticated.
import { revalidatePath } from "next/cache";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

type AccreditationType =
  | "accredited_investor"
  | "qualified_purchaser"
  | "qualified_client"
  | "institutional";

async function getValidSession(token: string) {
  if (!hasSupabaseServiceEnv()) return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("lp_onboarding_sessions")
    .select("id, status, expires_at, organization_id")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
  if (data.status === "complete" || data.status === "expired") return null;
  return { supabase, session: data };
}

export async function submitAccreditationAction(
  token: string,
  accreditationType: AccreditationType,
): Promise<{ ok: boolean } | { error: string }> {
  try {
    const ctx = await getValidSession(token);
    if (!ctx) return { error: "Invalid or expired link" };
    if (ctx.session.status !== "pending") return { error: "Already completed" };

    await ctx.supabase
      .from("lp_onboarding_sessions")
      .update({
        accreditation_type: accreditationType,
        accreditation_verified_at: new Date().toISOString(),
        status: "accreditation",
      })
      .eq("id", ctx.session.id);

    revalidatePath(`/lp/${token}`);
    return { ok: true };
  } catch {
    return { error: "Failed to save accreditation" };
  }
}

export async function signSubscriptionAction(
  token: string,
): Promise<{ ok: boolean } | { error: string }> {
  try {
    const ctx = await getValidSession(token);
    if (!ctx) return { error: "Invalid or expired link" };
    if (ctx.session.status !== "accreditation") return { error: "Not at subscription step" };

    await ctx.supabase
      .from("lp_onboarding_sessions")
      .update({
        subscription_signed_at: new Date().toISOString(),
        status: "subscription",
      })
      .eq("id", ctx.session.id);

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
    const ctx = await getValidSession(token);
    if (!ctx) return { error: "Invalid or expired link" };
    if (ctx.session.status !== "subscription") return { error: "Not at commitment step" };

    await ctx.supabase
      .from("lp_onboarding_sessions")
      .update({ status: "committed" })
      .eq("id", ctx.session.id);

    revalidatePath(`/lp/${token}`);
    return { ok: true };
  } catch {
    return { error: "Failed to confirm commitment" };
  }
}
