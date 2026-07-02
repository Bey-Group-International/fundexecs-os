"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { stripeConfigured, createCheckout, createPortalSession } from "@/lib/stripe";
import {
  PLAN_BY_KEY,
  CREDIT_PACKS,
  type PlanInterval,
  type PlanKey,
} from "@/lib/billing";
import { redeemCoupon } from "@/lib/coupons";

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

// Open Stripe Customer Portal for plan management (cancel, swap, update card).
// Redirects the browser to the portal URL; returns an error string on failure.
export async function openBillingPortalAction(): Promise<{ error?: string }> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    const { url, error } = await createPortalSession(ctx.orgId);
    if (error || !url) return { error: error ?? "Could not open billing portal." };

    redirect(url); // throws NEXT_REDIRECT — never returns normally
  } catch (err: unknown) {
    // next/navigation redirect throws NEXT_REDIRECT — re-throw so Next.js handles it.
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
    console.error("[wallet] openBillingPortalAction failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
  return {};
}

// Redeem a coupon code for a free credit grant. One-time per org.
export async function redeemCouponAction(
  formData: FormData,
): Promise<{ ok?: boolean; credits?: number; error?: string }> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    const code = String(formData.get("code") ?? "").trim();
    if (!code) return { error: "Enter a coupon code." };

    const result = await redeemCoupon(code, ctx.orgId);
    if (result.ok) revalidatePath("/wallet");
    return result;
  } catch (err) {
    console.error("[wallet] redeemCouponAction failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}
