"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { grantCredits } from "@/lib/credits";
import { stripeConfigured, createCheckout } from "@/lib/stripe";
import {
  PLAN_BY_KEY,
  CREDIT_PACKS,
  planGrantCredits,
  type PlanInterval,
  type PlanKey,
} from "@/lib/billing";

type ActionResult = { error?: string; ok?: boolean; url?: string };

// Subscribe to a plan. With Stripe configured this opens a hosted Checkout
// (subscription) and returns its URL; the plan is activated and credits granted
// on payment return. Without Stripe it falls back to mock activation so the flow
// still works in dev — setting the wallet plan/interval and front-loading credits.
export async function selectPlanAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const planKey = String(formData.get("plan_key") ?? "") as PlanKey;
  const interval: PlanInterval =
    String(formData.get("interval") ?? "monthly") === "annual" ? "annual" : "monthly";
  const plan = PLAN_BY_KEY[planKey];
  if (!plan) return { error: "Unknown plan" };

  if (stripeConfigured()) {
    return createCheckout({
      kind: "plan",
      orgId: ctx.orgId,
      createdBy: ctx.userId,
      planKey,
      interval,
    });
  }

  // Mock fallback.
  const service = createServiceClient();
  const { error } = await service
    .from("wallets")
    .upsert(
      { organization_id: ctx.orgId, plan: plan.key, plan_interval: interval },
      { onConflict: "organization_id" },
    );
  if (error) return { error: error.message };
  await grantCredits(service, ctx.orgId, planGrantCredits(plan, interval), "plan_grant", {
    note: `${plan.name} plan (${interval})`,
  });
  revalidatePath("/wallet");
  return { ok: true };
}

// Buy a one-off credit pack. Stripe Checkout when configured; mock grant otherwise.
export async function purchasePackAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const packKey = String(formData.get("pack_key") ?? "");
  const pack = CREDIT_PACKS.find((p) => p.key === packKey);
  if (!pack) return { error: "Unknown credit pack" };

  if (stripeConfigured()) {
    return createCheckout({ kind: "pack", orgId: ctx.orgId, createdBy: ctx.userId, packKey });
  }

  const service = createServiceClient();
  await grantCredits(service, ctx.orgId, pack.credits, "pack_purchase", {
    note: `${pack.credits} credit pack`,
  });
  revalidatePath("/wallet");
  return { ok: true };
}
