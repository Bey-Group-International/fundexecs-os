import type Stripe from "stripe";
import { type NextRequest, NextResponse } from "next/server";
import { getStripe, fulfillCheckout } from "@/lib/stripe";

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
  // Recurring subscription renewals (invoice.paid) can grant the plan's monthly
  // credits again here once recurring top-ups are desired; the initial period is
  // already granted at checkout.

  return NextResponse.json({ received: true });
}
