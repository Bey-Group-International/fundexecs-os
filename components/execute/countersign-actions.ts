"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

/**
 * The fund countersigns an LP's subscription agreement. Owners and admins only.
 * The signer's email is the signed-in member's confirmed email, never a form
 * field, and the session must belong to the member's own organization.
 */
export async function countersignSubscriptionAction(
  sessionId: string,
  signerName: string,
  agreed: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const generic = { ok: false as const, error: "We couldn't record your countersignature. Please try again." };
  if (typeof sessionId !== "string" || !sessionId) return generic;
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not signed in." };
  if (!canAdminOrg(ctx.role)) return { ok: false, error: "Only an owner or admin can countersign." };
  if (!ctx.emailConfirmed || !ctx.email) return { ok: false, error: "Confirm your email address before countersigning." };
  if (!hasSupabaseServiceEnv()) return generic;

  // The org check goes through the member's own client (row-level security).
  const mine = await createServerClient();
  const { data: owned } = await mine
    .from("lp_onboarding_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!owned) return generic;

  const service = createServiceClient();
  const { countersign, afterSigned } = await import("@/lib/lp-subscription-signing.server");
  const result = await countersign(service, {
    orgId: ctx.orgId,
    sessionId,
    signerName,
    signerEmail: ctx.email,
    agreed: agreed === true,
  });
  if (!result.ok) return result;

  const { after } = await import("next/server");
  const userId = ctx.userId;
  after(() => afterSigned(service, sessionId, "gp", userId).then(() => undefined, () => undefined));
  revalidatePath("/execute/closing");
  return { ok: true };
}
