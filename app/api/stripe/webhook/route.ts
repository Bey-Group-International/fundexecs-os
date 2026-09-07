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
// redirect-independent fulfillment path. Signatures are always verified; we
// never trust an unsigned body.
//
// Renewals are NOT driven from here any more. FundExecs owns the billing period
// (lib/subscriptions.server + the /api/cron sweep), and a plan checkout now buys
// one period rather than opening a Stripe subscription. What remains below is
// the LEGACY path: orgs that subscribed under the old mode=subscription flow
// still have Stripe billing them on Stripe's schedule, so their renewals and
// cancellations have to keep landing here until those subscriptions age out.
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

    // LEGACY subscriptions only: grant the plan's allotment on each Stripe-driven
    // renewal. Subscriptions created by the current flow are renewed by the cron
    // sweep instead — granting here as well would hand out two allotments per
    // period — so the handler checks that the org's subscription really is
    // Stripe-managed before granting. Keyed on billing_reason=subscription_cycle
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

              // Guard against double-granting: if this org's live subscription is
              // native (no processor_subscription_id), the cron sweep already
              // owns its renewals and this event is a duplicate of that work.
              const { data: liveSub } = await service
                .from("subscriptions")
                .select("id, processor_subscription_id")
                .eq("organization_id", orgId)
                .in("status", ["active", "past_due"])
                .maybeSingle();
              if (liveSub && !liveSub.processor_subscription_id) {
                console.warn(
                  "[stripe] ignoring legacy renewal for natively-managed subscription",
                  orgId,
                );
                return NextResponse.json({ received: true, ignored: "native_subscription" });
              }

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
    // A legacy Stripe subscription ended (cancelled in the Customer Portal, or
    // finally given up on after dunning). Without this the org kept its plan —
    // and its entitlements — forever, because nothing on our side ever heard.
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = (subscription.metadata as Record<string, string>)?.org_id;
      if (orgId) {
        const service = createServiceClient();
        // Close ONLY the row this Stripe subscription backs.
        const { data: closed } = await service
          .from("subscriptions")
          .update({ status: "canceled", ended_at: new Date().toISOString() })
          .eq("organization_id", orgId)
          .eq("processor_subscription_id", subscription.id)
          .in("status", ["active", "past_due"])
          .select("id");

        if (closed && closed.length > 0) {
          await service.from("subscription_events").insert({
            organization_id: orgId,
            subscription_id: closed[0].id,
            kind: "ended",
            note: "Stripe subscription cancelled",
          });

          // Drop the entitlement only if nothing else is paying for it. An org
          // that cancelled its old Stripe subscription and then subscribed again
          // natively must not lose the plan it is currently paying for — this
          // event can arrive (or be replayed) long after that.
          const { data: stillLive } = await service
            .from("subscriptions")
            .select("id")
            .eq("organization_id", orgId)
            .in("status", ["active", "past_due"])
            .limit(1);
          if (!stillLive || stillLive.length === 0) {
            await service
              .from("wallets")
              .update({ plan: null, plan_interval: null, plan_started_at: null })
              .eq("organization_id", orgId);
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
