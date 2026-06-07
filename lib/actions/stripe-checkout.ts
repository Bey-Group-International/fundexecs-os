'use server';

import Stripe from 'stripe';
import { headers } from 'next/headers';
import { getActiveOrg } from '@/lib/queries/org';
import { TOPUP_TIERS, type TopUpTier } from '@/lib/billing/topup-tiers';

/* ============================================================================
 * lib/actions/stripe-checkout.ts — Stripe credit top-up checkout.
 *
 * Creates a real Stripe Checkout Session (mode: 'payment') for a credit tier
 * and returns its URL for client-side redirect. The session carries the org id
 * + credit/cents amounts in `metadata` so the webhook
 * (`app/api/stripe/webhook/route.ts`) can credit the wallet idempotently via
 * the `record_credit_topup` RPC on `checkout.session.completed`.
 *
 * Env-gated: when `STRIPE_SECRET_KEY` is absent the action returns a clean
 * "not configured" result so the wallet popover renders its graceful state
 * (beta deployments without billing keys still work).
 * ========================================================================= */

export interface TopUpCheckoutResult {
  ok: boolean;
  /** Stripe Checkout Session URL — redirect the user here on success. */
  url?: string;
  error?: string;
}

function resolveSiteOrigin(hdrs: Headers): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host');
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : 'http://localhost:3000';
}

/**
 * createTopUpCheckout — create a Stripe Checkout Session for a credit tier and
 * return its redirect URL. Validates the tier, scopes to the caller's active
 * org, and stamps metadata the webhook reconciles against.
 */
export async function createTopUpCheckout(credits: TopUpTier): Promise<TopUpCheckoutResult> {
  const tier = TOPUP_TIERS.find((t) => t.credits === credits);
  if (!tier) {
    return { ok: false, error: 'Invalid credit tier selected.' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return {
      ok: false,
      error: 'Credit top-up is not yet enabled on this deployment. Check back soon.'
    };
  }

  try {
    const org = await getActiveOrg();
    if (!org) {
      return { ok: false, error: 'No active workspace — sign in and try again.' };
    }

    const hdrs = await headers();
    const origin = resolveSiteOrigin(hdrs);
    const stripe = new Stripe(secretKey);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: org.orgId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: tier.amountCents,
            product_data: {
              name: `${tier.credits.toLocaleString()} FundExecs credits`,
              description: 'Credit top-up for your FundExecs OS workspace.'
            }
          }
        }
      ],
      metadata: {
        org_id: org.orgId,
        amount_credits: String(tier.credits),
        amount_cents: String(tier.amountCents)
      },
      success_url: `${origin}/settings?topup=success`,
      cancel_url: `${origin}/settings?topup=cancel`
    });

    if (!session.url) {
      return { ok: false, error: 'Stripe did not return a checkout URL. Please try again.' };
    }
    return { ok: true, url: session.url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not start checkout. Please try again.'
    };
  }
}
