import type Stripe from "stripe";
import { type NextRequest, NextResponse } from "next/server";
import { getStripe, fulfillCheckout } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import { claimStripeEvent, releaseStripeEvent } from "@/lib/stripe-events";
import {
  PLAN_BY_KEY,
  planGrantCredits,
  loyaltyBonus,
  tenureMonths,
  type PlanKey,
  type PlanInterval,
} from "@/lib/billing";

export const dynamic = "force-dynamic";

// Optional Stripe webhook. Fulfillment is already handled by the success
// redirect (app/api/stripe/return), so this route is dormant unless
// STRIPE_WEBHOOK_SECRET is configured — at which point it provides a second,
// redirect-independent fulfillment path (and a home for recurring subscription
// top-ups). Signatures are always verified; we never trust an unsigned body.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: true, skipped: "STRIPE_WEBHOOK_SECRET not set" });
  }

  const signature = req.headers.get("stripe-signature") ?? "";
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency gate: Stripe delivers at least once and redelivers on any
  // non-2xx, so claim the event id before applying it. A duplicate redelivery
  // is acknowledged (2xx) but not re-processed, so renewal credits can't be
  // double-granted. On failure we release the claim so the retry re-processes.
  const fresh = await claimStripeEvent(event.id, event.type);
  if (!fresh) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await fulfillCheckout(session.id);
    }

    // Grant the plan's monthly credit allotment on each subscription renewal.
    // The initial period is already granted at checkout; this handles every cycle
    // after that. We key on invoice.payment_succeeded + billing_reason=subscription_cycle
    // to avoid double-granting the first invoice (which fires alongside checkout).
    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.billing_reason === "subscription_cycle") {
        const sub = invoice.subscription;
        const subId = typeof sub === "string" ? sub : sub?.id;
        if (subId) {
          try {
            const stripe = getStripe();
            const subscription = await stripe.subscriptions.retrieve(subId);
            const meta = subscription.metadata as Record<string, string>;
            const orgId = meta.org_id ?? invoice.metadata?.org_id;
            const planKey = meta.plan_key ?? invoice.metadata?.plan_key;
            const metaInterval = meta.interval ?? invoice.metadata?.interval;
            const plan = planKey ? PLAN_BY_KEY[planKey as PlanKey] : null;
            if (orgId && plan) {
              const service = createServiceClient();
              const { data: walletRow } = await service
                .from("wallets")
                .select("plan_started_at, plan_interval")
                .eq("organization_id", orgId)
                .maybeSingle();
              // Subscriptions created before metadata wiring (or whose interval
              // changed via the Stripe Dashboard/Portal) carry no usable interval
              // metadata — fall back to the wallet's recorded plan_interval so an
              // annual renewal isn't granted a single month of credits.
              const interval: PlanInterval =
                (metaInterval ?? walletRow?.plan_interval) === "annual" ? "annual" : "monthly";
              // planGrantCredits returns creditsPerMonth for monthly, creditsPerMonth*12
              // for annual. Annual subscriptions bill once/year via Stripe, so this
              // event fires once/year — we must grant the full annual allotment.
              await grantCredits(service, orgId, planGrantCredits(plan, interval), "plan_grant", {
                note: `${plan.name} plan — renewal (${interval})`,
              });
              // Also grant the loyalty bonus accrued since plan_started_at so the
              // dashboard's loyalty display and the actual credit grant stay in sync.
              const tenure = tenureMonths(walletRow?.plan_started_at);
              const bonus = loyaltyBonus(tenure);
              if (bonus > 0) {
                await grantCredits(service, orgId, bonus, "loyalty", {
                  note: `${plan.name} plan — loyalty bonus (month ${tenure})`,
                });
              }
            }
          } catch (err) {
            console.error("[stripe] renewal grant failed:", err);
          }
        }
      }
    }
  } catch (err) {
    await releaseStripeEvent(event.id);
    console.error("[stripe] webhook handler failed:", err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
