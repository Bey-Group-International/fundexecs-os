"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { stripeConfigured, createCheckout, createPortalSession } from "@/lib/stripe";
import { outstandingInvoice } from "@/lib/subscription-invoices.server";
import {
  getSubscription,
  changePlan,
  cancelSubscription,
  resumeSubscription,
  startSubscription,
} from "@/lib/subscriptions.server";
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

// A purchase action returns ONE of:
//   clientSecret — mount Stripe Embedded Checkout in-app
//   checkoutUrl  — send the browser to hosted Stripe Checkout (no publishable key)
//   native       — open the in-app confirm step (no processor configured)
//   ok           — the change was applied server-side (a plan change on an
//                  existing subscription, paid with the card already on file)
//   error        — surface it inline
type ActionResult = {
  error?: string;
  ok?: boolean;
  clientSecret?: string;
  checkoutUrl?: string;
  native?: PurchaseSummary;
  credits?: number;
};

// Choose a plan.
//
// Two distinct cases, and conflating them was the old bug: an org with no
// subscription is BUYING one, while an org that already has one is CHANGING it.
// Running checkout for a change opened a second subscription and billed the
// operator twice, so a change is routed to the native engine instead, which
// prorates the difference against the card already on file.
export async function selectPlanAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };

    const planKey = String(formData.get("plan_key") ?? "") as PlanKey;
    const interval: PlanInterval =
      String(formData.get("interval") ?? "monthly") === "annual" ? "annual" : "monthly";
    const plan = PLAN_BY_KEY[planKey];
    if (!plan) return { error: "Unknown plan" };

    // Already subscribed → this is a plan change, whichever rail is configured.
    const existing = await getSubscription(ctx.orgId);
    if (existing) {
      const res = await changePlan({ orgId: ctx.orgId, planKey, interval });
      if (!res.ok) {
        // An upgrade we could not charge (no card on file, or a decline) — send
        // them somewhere they can fix it rather than failing silently.
        return { error: res.error ?? "Could not change your plan." };
      }
      revalidatePath("/wallet");
      return { ok: true, credits: res.credits };
    }

    if (stripeConfigured()) {
      // Collect the first period. Returns a client secret (in-app form) or a
      // hosted Checkout URL, depending on how Stripe is configured.
      return checkoutResult(
        await createCheckout({
          kind: "plan",
          orgId: ctx.orgId,
          createdBy: ctx.userId,
          planKey,
          interval,
        }),
      );
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

// createCheckout hands back EITHER an in-app client secret or a hosted Checkout
// URL depending on how Stripe is configured. Renaming `url` here keeps the
// client's branch explicit — and stops the hosted URL from being quietly dropped
// on the way through, which would leave a secret-key-only deployment unable to
// sell at all.
function checkoutResult(res: { clientSecret?: string; url?: string; error?: string }): ActionResult {
  return res.error
    ? { error: res.error }
    : { clientSecret: res.clientSecret, checkoutUrl: res.url };
}

// Cancel at period end. Access continues through the period already paid for —
// see lib/subscriptions.server.
export async function cancelSubscriptionAction(): Promise<{ ok?: boolean; error?: string }> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };
    const res = await cancelSubscription(ctx.orgId);
    if (res.ok) revalidatePath("/wallet");
    return res.ok ? { ok: true } : { error: res.error };
  } catch (err) {
    console.error("[wallet] cancelSubscriptionAction failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}

// Withdraw a pending cancellation while the period is still running.
export async function resumeSubscriptionAction(): Promise<{ ok?: boolean; error?: string }> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };
    const res = await resumeSubscription(ctx.orgId);
    if (res.ok) revalidatePath("/wallet");
    return res.ok ? { ok: true } : { error: res.error };
  } catch (err) {
    console.error("[wallet] resumeSubscriptionAction failed:", err);
    return { error: "Something went wrong. Please try again." };
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
      return checkoutResult(
        await createCheckout({ kind: "pack", orgId: ctx.orgId, createdBy: ctx.userId, packKey }),
      );
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
      // A plan is a subscription, not a one-off grant: start it through the
      // engine so it has a period, renews, and can be cancelled — the native
      // rail settles the charge in-app.
      const res = await startSubscription({
        orgId: ctx.orgId,
        createdBy: ctx.userId,
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


/**
 * Pay an outstanding subscription invoice by card — the fallback for anyone who
 * needs the period to start today rather than waiting on a transfer.
 *
 * The amount is re-derived from the stored invoice here, server-side, and the
 * invoice is re-checked against the caller's own organization: a browser can
 * name an invoice id, so it must never be trusted to name a price or to reach
 * another org's bill.
 */
export async function payInvoiceByCardAction(invoiceId: string): Promise<ActionResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { error: "Not authenticated" };
    if (!stripeConfigured()) {
      return { error: "Card payment isn't available here. Please pay by transfer." };
    }

    const invoice = await outstandingInvoice(ctx.orgId);
    if (!invoice || invoice.id !== invoiceId) {
      return { error: "That invoice is no longer outstanding." };
    }
    if (invoice.status === "processing") {
      // A bank debit is already collecting this. Paying again by card would take
      // the money twice, and the debit cannot be recalled once submitted.
      return {
        error:
          "We're already collecting this from your linked account. It'll clear shortly — no need to pay again.",
      };
    }

    return checkoutResult(
      await createCheckout({
        kind: "subscription_invoice",
        orgId: ctx.orgId,
        createdBy: ctx.userId,
        invoiceId: invoice.id,
        number: invoice.number,
        amountUsd: invoice.amount_usd,
      }),
    );
  } catch (err) {
    console.error("[wallet] payInvoiceByCardAction failed:", err);
    return { error: "Something went wrong starting checkout. Please try again." };
  }
}
