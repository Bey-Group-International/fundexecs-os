// Stripe integration. Hosted Checkout only: the server creates a Checkout
// Session and hands back its URL, the browser is redirected to Stripe, and on
// return we retrieve the session and fulfill (grant credits / activate the plan
// / create the paid gift) idempotently.
//
// Only STRIPE_SECRET_KEY is required to operate; STRIPE_PUBLISHABLE_KEY is
// documented for client-side Stripe.js but unused by the redirect flow. When no
// secret is set, stripeConfigured() is false and callers fall back to the
// existing mock grants, so local/dev without keys still works end-to-end.
//
// Fulfillment is driven by the success redirect (we verify payment_status server
// side), so no webhook secret is needed. An optional webhook route additionally
// fulfills — and handles recurring subscription top-ups — when STRIPE_WEBHOOK_SECRET
// is later configured.
import Stripe from "stripe";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import { purchaseGift } from "@/lib/gift-earn";
import {
  PLAN_BY_KEY,
  CREDIT_PACKS,
  planGrantCredits,
  type PlanInterval,
  type PlanKey,
} from "@/lib/billing";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? "";

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

// Absolute base URL for Checkout success/cancel redirects. Prefer the request's
// own origin so previews and localhost work, then the configured app URL.
function appBaseUrl(): string {
  const h = headers();
  const origin = h.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  const host = h.get("host");
  if (host) {
    const proto = host.startsWith("localhost") ? "http" : "https";
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://fundexecs.com";
}

// What a Checkout Session is buying. The discriminant + fields are also written
// to the session metadata so fulfillment is self-contained.
export type CheckoutIntent =
  | { kind: "plan"; orgId: string; createdBy: string | null; planKey: PlanKey; interval: PlanInterval }
  | { kind: "pack"; orgId: string; createdBy: string | null; packKey: string }
  | {
      kind: "gift";
      orgId: string;
      createdBy: string | null;
      packKey: string;
      recipientEmail: string;
      message?: string;
    };

// Build a hosted Checkout Session for an intent and record it pending. Returns
// the URL to redirect the browser to.
export async function createCheckout(
  intent: CheckoutIntent,
): Promise<{ url?: string; error?: string }> {
  const stripe = getStripe();
  const base = appBaseUrl();

  let params: Stripe.Checkout.SessionCreateParams;
  let amountUsd = 0;
  const metadata: Record<string, string> = {
    kind: intent.kind,
    org_id: intent.orgId,
    created_by: intent.createdBy ?? "",
  };

  if (intent.kind === "plan") {
    const plan = PLAN_BY_KEY[intent.planKey];
    if (!plan) return { error: "Unknown plan" };
    const recurring: Stripe.Checkout.SessionCreateParams.LineItem.PriceData.Recurring = {
      interval: intent.interval === "annual" ? "year" : "month",
    };
    amountUsd = intent.interval === "annual" ? plan.annual : plan.monthly;
    metadata.plan_key = plan.key;
    metadata.interval = intent.interval;
    params = {
      mode: "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amountUsd * 100),
            recurring,
            product_data: { name: `FundExecs OS — ${plan.name} plan` },
          },
        },
      ],
    };
  } else if (intent.kind === "pack") {
    const pack = CREDIT_PACKS.find((p) => p.key === intent.packKey);
    if (!pack) return { error: "Unknown credit pack" };
    amountUsd = pack.price;
    metadata.pack_key = pack.key;
    params = {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(pack.price * 100),
            product_data: { name: `${pack.credits.toLocaleString()} credit pack` },
          },
        },
      ],
    };
  } else {
    const pack = CREDIT_PACKS.find((p) => p.key === intent.packKey);
    if (!pack) return { error: "Pick a credit pack to gift." };
    const email = intent.recipientEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return { error: "Enter a valid recipient email." };
    amountUsd = pack.price;
    metadata.pack_key = pack.key;
    metadata.recipient_email = email;
    if (intent.message) metadata.message = intent.message.slice(0, 400);
    params = {
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(pack.price * 100),
            product_data: { name: `Gift: ${pack.credits.toLocaleString()} FundExecs credits` },
          },
        },
      ],
    };
  }

  const dest = intent.kind === "gift" ? "/gift" : "/wallet";
  const session = await stripe.checkout.sessions.create({
    ...params,
    client_reference_id: intent.orgId,
    metadata,
    success_url: `${base}/api/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}${dest}?checkout=cancelled`,
  });

  if (!session.url) return { error: "Stripe did not return a checkout URL." };

  // Record the pending checkout so fulfillment is single-shot and auditable.
  const service = createServiceClient();
  await service.from("stripe_checkouts").insert({
    organization_id: intent.orgId,
    session_id: session.id,
    kind: intent.kind,
    amount_usd: amountUsd,
    status: "pending",
    metadata,
    created_by: intent.createdBy,
  });

  return { url: session.url };
}

export interface FulfillResult {
  ok: boolean;
  kind?: string;
  error?: string;
  alreadyFulfilled?: boolean;
}

// Verify a completed Checkout Session and apply its effect exactly once. Safe to
// call from both the success redirect and the optional webhook.
export async function fulfillCheckout(sessionId: string): Promise<FulfillResult> {
  if (!sessionId) return { ok: false, error: "Missing session id" };
  const service = createServiceClient();

  const { data: row } = await service
    .from("stripe_checkouts")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (row?.status === "fulfilled") return { ok: true, kind: row.kind, alreadyFulfilled: true };

  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  const paid = session.payment_status === "paid" || session.status === "complete";
  if (!paid) return { ok: false, error: "Payment not completed" };

  const meta = (session.metadata ?? {}) as Record<string, string>;
  const orgId = meta.org_id || row?.organization_id;
  const kind = meta.kind || row?.kind;
  if (!orgId || !kind) return { ok: false, error: "Checkout is missing fulfillment metadata" };
  const createdBy = meta.created_by || null;

  if (kind === "plan") {
    const planKey = meta.plan_key as PlanKey;
    const plan = PLAN_BY_KEY[planKey];
    const interval: PlanInterval = meta.interval === "annual" ? "annual" : "monthly";
    if (plan) {
      await service
        .from("wallets")
        .upsert(
          { organization_id: orgId, plan: plan.key, plan_interval: interval },
          { onConflict: "organization_id" },
        );
      await grantCredits(service, orgId, planGrantCredits(plan, interval), "plan_grant", {
        note: `${plan.name} plan (${interval}) — Stripe`,
      });
    }
  } else if (kind === "pack") {
    const pack = CREDIT_PACKS.find((p) => p.key === meta.pack_key);
    if (pack) {
      await grantCredits(service, orgId, pack.credits, "pack_purchase", {
        note: `${pack.credits} credit pack — Stripe`,
      });
    }
  } else if (kind === "gift") {
    // The gift only exists once paid: create it now so it's redeemable.
    await purchaseGift({
      senderOrgId: orgId,
      createdBy,
      recipientEmail: meta.recipient_email ?? "",
      packKey: meta.pack_key ?? "",
      message: meta.message,
    });
  }

  await service
    .from("stripe_checkouts")
    .update({ status: "fulfilled", fulfilled_at: new Date().toISOString() })
    .eq("session_id", sessionId);

  return { ok: true, kind };
}
