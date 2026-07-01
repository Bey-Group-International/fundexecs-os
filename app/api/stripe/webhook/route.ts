import type Stripe from "stripe";
import { type NextRequest, NextResponse } from "next/server";
import { getStripe, fulfillCheckout } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import { PLAN_BY_KEY, type PlanKey } from "@/lib/billing";

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
          const plan = planKey ? PLAN_BY_KEY[planKey as PlanKey] : null;
          if (orgId && plan) {
            const service = createServiceClient();
            await grantCredits(service, orgId, plan.creditsPerMonth, "plan_grant", {
              note: `${plan.name} plan — renewal`,
            });
          }
        } catch (err) {
          console.error("[stripe] renewal grant failed:", err);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
