"use server";

import { getSessionContext } from "@/lib/auth";
import { stripeConfigured, createCheckout } from "@/lib/stripe";
import {
  PLAN_BY_KEY,
  CREDIT_PACKS,
  type PlanInterval,
  type PlanKey,
} from "@/lib/billing";

type ActionResult = { error?: string; ok?: boolean; clientSecret?: string };

// Subscribe to a plan. With Stripe configured this opens an in-app embedded
// Checkout (subscription) and returns its client_secret; the plan is activated
// and credits granted on payment return. Without Stripe we fail closed so
// credits are never granted without payment.
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

    return { error: "Billing is not enabled for this organization yet. Contact support to activate checkout." };
  } catch (err) {
    console.error("[wallet] selectPlanAction failed:", err);
    return { error: "Something went wrong starting checkout. Please try again." };
  }
}

// Buy a one-off credit pack. Embedded Checkout when configured; otherwise fail
// closed so credits are never granted without payment.
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

    return { error: "Billing is not enabled for this organization yet. Contact support to add credits." };
  } catch (err) {
    console.error("[wallet] purchasePackAction failed:", err);
    return { error: "Something went wrong starting checkout. Please try again." };
  }
}
