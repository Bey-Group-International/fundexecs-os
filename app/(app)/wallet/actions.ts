"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { grantCredits } from "@/lib/credits";
import {
  PLAN_BY_KEY,
  CREDIT_PACKS,
  planGrantCredits,
  type PlanInterval,
} from "@/lib/billing";

// Activate a plan (payment mocked). Sets the org's wallet plan/interval and
// front-loads the plan's credits, recording a ledger entry. No card is charged
// until a provider is wired — this makes the plan picker real end-to-end so the
// "Current plan" badge, rollover, and loyalty all reflect a live choice.
export async function selectPlanAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const planKey = String(formData.get("plan_key") ?? "");
  const interval = String(formData.get("interval") ?? "monthly") as PlanInterval;
  const plan = PLAN_BY_KEY[planKey as keyof typeof PLAN_BY_KEY];
  if (!plan) return { error: "Unknown plan" };

  const service = createServiceClient();
  const grant = planGrantCredits(plan, interval === "annual" ? "annual" : "monthly");

  // Activate the plan first (set / reset the tenure clock via updated_at).
  const { error } = await service
    .from("wallets")
    .upsert(
      {
        organization_id: ctx.orgId,
        plan: plan.key,
        plan_interval: interval === "annual" ? "annual" : "monthly",
      },
      { onConflict: "organization_id" },
    );
  if (error) return { error: error.message };

  await grantCredits(service, ctx.orgId, grant, "plan_grant", {
    note: `${plan.name} plan (${interval})`,
  });

  revalidatePath("/wallet");
  return { ok: true };
}

// Buy a one-off credit pack (payment mocked) — grants the pack's credits to the
// org's own wallet.
export async function purchasePackAction(
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const pack = CREDIT_PACKS.find((p) => p.key === String(formData.get("pack_key") ?? ""));
  if (!pack) return { error: "Unknown credit pack" };

  const service = createServiceClient();
  await grantCredits(service, ctx.orgId, pack.credits, "pack_purchase", {
    note: `${pack.credits} credit pack`,
  });

  revalidatePath("/wallet");
  return { ok: true };
}
