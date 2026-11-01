"use server";

// Run › Onboarding: erasing one LP's data at their request. Owner/admin only, the LP
// must be one of this organization's, and the caller must retype the LP's name.
import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { requireOrgAdmin } from "@/lib/rbac";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { confirmsName, eraseMessage } from "@/lib/lp-retention";
import { eraseLp } from "@/lib/lp-retention.server";

const GENERIC = "Couldn't erase. Try again.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EraseResult = { ok: boolean; message: string };

export async function eraseLpAction(sessionId: unknown, typedName: unknown): Promise<EraseResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, message: "Sign in again to continue." };
  if (!requireOrgAdmin(auth.ctx.role).ok) return { ok: false, message: "Only organization owners and admins can erase an LP." };
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) return { ok: false, message: "That LP wasn't found." };
  if (!hasSupabaseServiceEnv()) return { ok: false, message: GENERIC };

  try {
    // Read through the caller's own client so row-level security confirms the LP is theirs.
    const supabase = await createServerClient();
    const { data } = await supabase
      .from("lp_onboarding_sessions")
      .select("lp_name")
      .eq("id", sessionId)
      .eq("organization_id", auth.ctx.orgId)
      .maybeSingle();
    const lpName = (data as { lp_name: string } | null)?.lp_name;
    if (!lpName) return { ok: false, message: "That LP wasn't found." };
    if (!confirmsName(typedName, lpName)) return { ok: false, message: "Type the LP's name exactly to confirm." };

    const outcome = await eraseLp(createServiceClient(), { orgId: auth.ctx.orgId, sessionId, actorId: auth.ctx.userId });
    if (outcome === "error") return { ok: false, message: GENERIC };
    revalidatePath("/run/onboarding");
    const m = eraseMessage(outcome);
    return { ok: m.ok, message: m.text };
  } catch (err) {
    console.error("eraseLpAction threw", err);
    return { ok: false, message: GENERIC };
  }
}
