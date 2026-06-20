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

type ActionResult = { error?: string; ok?: boolean; clientSecret?: string };

// Subscribe to a plan. With Stripe configured this opens an in-app embedded
// Checkout (subscription) and returns its client_secret; the plan is activated
// and credits granted on payment return. Without Stripe it falls back to mock
// activation. Every path is guarded so a provider/DB error surfaces inline
// instead of throwing a 500 that blanks the page.
export async function selectPlanAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    const planKey = String(formData.get("plan_key") ?? "") as PlanKey;
    const interval: PlanInterval =
      String(formData.get("interval") ?? "monthly") === "annual" ? "annual" : "monthly";
    const plan = PLAN_BY_KEY[planKey];
    if (!plan) return { error: "Unknown plan" };

    if (stripeConfigured()) {
      return await createCheckout({
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
  } catch (err) {
    console.error("[wallet] selectPlanAction failed:", err);
    return { error: "Something went wrong starting checkout. Please try again." };
  }
}

// Buy a one-off credit pack. Embedded Checkout when configured; mock grant
// otherwise. Guarded so failures surface inline rather than crashing the page.
export async function purchasePackAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    const packKey = String(formData.get("pack_key") ?? "");
    const pack = CREDIT_PACKS.find((p) => p.key === packKey);
    if (!pack) return { error: "Unknown credit pack" };

    if (stripeConfigured()) {
      return await createCheckout({ kind: "pack", orgId: ctx.orgId, createdBy: ctx.userId, packKey });
    }

    const service = createServiceClient();
    await grantCredits(service, ctx.orgId, pack.credits, "pack_purchase", {
      note: `${pack.credits} credit pack`,
    });
    revalidatePath("/wallet");
    return { ok: true };
  } catch (err) {
    console.error("[wallet] purchasePackAction failed:", err);
    return { error: "Something went wrong starting checkout. Please try again." };
  }
}
