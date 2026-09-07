// lib/billing-rail.ts
// How a subscription charge is actually settled.
//
// The subscription lifecycle (lib/subscriptions) is native: FundExecs decides
// when a period ends and what it costs. This module is the narrow seam where
// that decision meets money, so the engine never has to know which processor —
// if any — is configured.
//
//   native rail  → no external processor. The charge is recorded and settles
//                  immediately. This is what runs in development, in demos, and
//                  for any deployment that hasn't connected a processor.
//   stripe rail  → an off-session PaymentIntent against the card saved at
//                  checkout, so a renewal can be charged with nobody present.
//
// Note this deliberately does NOT use Stripe's own subscription billing. Stripe
// running its own schedule would mean two systems disagreeing about when a period
// ends; instead Stripe charges one payment per period, when we say so.
import { randomUUID } from "crypto";
import { getStripe, stripeConfigured } from "@/lib/stripe";

export interface ChargeRequest {
  orgId: string;
  amountUsd: number;
  /** Human description on the processor's receipt. */
  description: string;
  /** Processor customer, from the subscription row. */
  customerId?: string | null;
  /** Saved payment method to charge off-session. */
  paymentMethodId?: string | null;
  /**
   * Stable key for this charge (e.g. `<subscriptionId>:<periodStart>`), so a
   * retried sweep can never double-charge the same period.
   */
  idempotencyKey: string;
}

export interface ChargeResult {
  ok: boolean;
  /** Processor reference for the settled charge — recorded on the ledger event. */
  reference?: string;
  /** Operator-safe failure reason, stored on the subscription for the UI. */
  error?: string;
  /**
   * The card needs the cardholder present (3DS / bank challenge). The charge
   * failed, but it is worth retrying interactively rather than just dunning.
   */
  requiresAction?: boolean;
}

/** Which rail a new subscription should record itself against. */
export function activeRail(): "stripe" | "native" {
  return stripeConfigured() ? "stripe" : "native";
}

/**
 * Settle a subscription charge. Never throws: a rail failure is a `past_due`
 * subscription, not a 500 on the cron sweep.
 */
export async function chargeSubscription(req: ChargeRequest): Promise<ChargeResult> {
  // A zero-price period (a back-filled subscriber, or a fully discounted plan)
  // needs no rail at all.
  if (!(req.amountUsd > 0)) {
    return { ok: true, reference: `free_${req.idempotencyKey}` };
  }

  if (!stripeConfigured()) {
    // Native rail: there is no processor to call, so the charge is recorded and
    // settles in-app. Value is granted the same way either way — the difference
    // is only whether money moved.
    return { ok: true, reference: `native_${randomUUID()}` };
  }

  if (!req.customerId || !req.paymentMethodId) {
    return {
      ok: false,
      error: "No saved payment method. Add a card to keep this plan active.",
      requiresAction: true,
    };
  }

  try {
    const intent = await getStripe().paymentIntents.create(
      {
        amount: Math.round(req.amountUsd * 100),
        currency: "usd",
        customer: req.customerId,
        payment_method: req.paymentMethodId,
        // Charge without the cardholder present — this is the whole point of
        // saving the method at checkout.
        off_session: true,
        confirm: true,
        description: req.description,
        metadata: { org_id: req.orgId, idempotency_key: req.idempotencyKey },
      },
      { idempotencyKey: req.idempotencyKey },
    );

    if (intent.status === "succeeded") return { ok: true, reference: intent.id };

    // requires_action means the bank wants the cardholder to authenticate — the
    // operator has to come back and confirm interactively.
    if (intent.status === "requires_action" || intent.status === "requires_confirmation") {
      return {
        ok: false,
        requiresAction: true,
        error: "Your bank needs you to confirm this payment.",
        reference: intent.id,
      };
    }

    return { ok: false, error: `Payment ${intent.status.replace(/_/g, " ")}.`, reference: intent.id };
  } catch (err) {
    return { ok: false, ...friendlyChargeError(err) };
  }
}

// Map a processor error to something an operator can act on, without leaking
// internals. Logged server-side for diagnosis.
function friendlyChargeError(err: unknown): { error: string; requiresAction?: boolean } {
  const e = err as { code?: string; decline_code?: string; message?: string; type?: string };
  console.error("[billing-rail] charge failed:", e?.type ?? "", e?.code ?? "", err);

  switch (e?.code) {
    case "card_declined":
      return { error: "Your card was declined. Try another payment method.", requiresAction: true };
    case "expired_card":
      return { error: "Your card has expired. Update your payment method.", requiresAction: true };
    case "insufficient_funds":
      return { error: "Your card had insufficient funds.", requiresAction: true };
    case "authentication_required":
      return { error: "Your bank needs you to confirm this payment.", requiresAction: true };
    default:
      return { error: "We couldn't process the payment. We'll try again shortly." };
  }
}
