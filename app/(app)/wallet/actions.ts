"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { stripeConfigured, createCheckout, createPortalSession } from "@/lib/stripe";
import {
  PLAN_BY_KEY,
  CREDIT_PACKS,
  planPurchaseSummary,
  packPurchaseSummary,
  type PlanInterval,
  type PlanKey,
  type PurchaseSummary,
} from "@/lib/billing";
import { completeNativePurchase } from "@/lib/purchase";
import { redeemCoupon } from "@/lib/coupons";

// A purchase action returns ONE of: a Stripe embedded-checkout client secret
// (when Stripe is configured), or a `native` summary telling the client to open
// the in-app confirm flow (when Stripe isn't configured), or an error.
type ActionResult = {
  error?: string;
  ok?: boolean;
  clientSecret?: string;
  native?: PurchaseSummary;
  credits?: number;
};

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

    // No external processor configured — offer the native in-app checkout. The
    // client opens a confirm step, then calls confirmNativePurchaseAction.
    const native = planPurchaseSummary(planKey, interval);
    return native
      ? { native }
      : { error: "Unknown plan" };
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

    // No external processor configured — offer the native in-app checkout.
    const native = packPurchaseSummary(packKey);
    return native ? { native } : { error: "Unknown credit pack" };
  } catch (err) {
    console.error("[wallet] purchasePackAction failed:", err);
    return { error: "Something went wrong starting checkout. Please try again." };
  }
}

// Complete a native (Stripe-free) purchase after the user confirms it in-app.
// Gated to ONLY run when Stripe is not configured, so it can never grant paid
// value while a real processor is active. Applies the plan/pack effect and
// records the transaction, then revalidates the Wallet page.
export async function confirmNativePurchaseAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    // Defense-in-depth: never hand out value natively when Stripe is live.
    if (stripeConfigured()) {
      return { error: "Please complete checkout with the secure payment form." };
    }

    const kind = String(formData.get("kind") ?? "");
    if (kind === "plan") {
      const planKey = String(formData.get("plan_key") ?? "") as PlanKey;
      const interval: PlanInterval =
        String(formData.get("interval") ?? "monthly") === "annual" ? "annual" : "monthly";
      if (!PLAN_BY_KEY[planKey]) return { error: "Unknown plan" };
      const res = await completeNativePurchase({
        orgId: ctx.orgId,
        createdBy: ctx.userId,
        kind: "plan",
        planKey,
        interval,
      });
      if (res.ok) revalidatePath("/wallet");
      return res.ok ? { ok: true, credits: res.credits } : { error: res.error };
    }

    if (kind === "pack") {
      const packKey = String(formData.get("pack_key") ?? "");
      if (!CREDIT_PACKS.some((p) => p.key === packKey)) return { error: "Unknown credit pack" };
      const res = await completeNativePurchase({
        orgId: ctx.orgId,
        createdBy: ctx.userId,
        kind: "pack",
        packKey,
      });
      if (res.ok) revalidatePath("/wallet");
      return res.ok ? { ok: true, credits: res.credits } : { error: res.error };
    }

    return { error: "Unknown purchase." };
  } catch (err) {
    console.error("[wallet] confirmNativePurchaseAction failed:", err);
    return { error: "Something went wrong completing your purchase. Please try again." };
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
