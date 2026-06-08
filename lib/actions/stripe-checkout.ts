'use server';

import Stripe from 'stripe';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getOrgSubscription } from '@/lib/queries/subscription';
import { getPlan, unitPriceCents, type BillingInterval, type PlanId } from '@/lib/billing/plans';
import {
  CREDITS_PER_DOLLAR,
  isValidCreditPack,
  type CreditPackDollars
} from '@/lib/billing/credit-packs';

/* ============================================================================
 * lib/actions/stripe-checkout.ts — Stripe checkout for the Plan & Credits surface.
 *
 *   - createSubscriptionCheckout : recurring plan (mode 'subscription')
 *   - createCustomTopUpCheckout  : one-off custom credit pack (mode 'payment')
 *   - createBillingPortalSession : manage an existing subscription
 *
 * Subscription prices are built inline with `price_data` (recurring), so no
 * Stripe products need pre-provisioning in the dashboard. Sessions carry org +
 * plan/credit metadata that the webhook (`app/api/stripe/webhook/route.ts`)
 * reconciles idempotently.
 *
 * Env-gated: when `STRIPE_SECRET_KEY` is absent every action returns a clean
 * "not configured" result so the UI renders its graceful state (beta
 * deployments without billing keys still work).
 * ========================================================================= */

export interface CheckoutResult {
  ok: boolean;
  /** Stripe-hosted URL — redirect the user here on success. */
  url?: string;
  error?: string;
}

const NOT_CONFIGURED = 'Billing is not yet enabled on this deployment. Check back soon.';

function resolveSiteOrigin(hdrs: Headers): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host');
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : 'http://localhost:3000';
}

async function currentUserEmail(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    return user?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * createSubscriptionCheckout — start a recurring plan subscription. Validates
 * the plan/interval, scopes to the caller's active org, and stamps the metadata
 * the webhook reconciles against. Per-seat plans bill `seats` quantity.
 */
export async function createSubscriptionCheckout(
  planId: PlanId,
  interval: BillingInterval,
  seatsInput = 1
): Promise<CheckoutResult> {
  const plan = getPlan(planId);
  if (!plan || plan.kind !== 'paid') {
    return { ok: false, error: 'That plan is not available for self-serve checkout.' };
  }

  const unitAmount = unitPriceCents(plan, interval);
  if (!unitAmount || unitAmount <= 0) {
    return { ok: false, error: 'That plan is not available for self-serve checkout.' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { ok: false, error: NOT_CONFIGURED };

  try {
    const org = await getActiveOrg();
    if (!org) return { ok: false, error: 'No active workspace — sign in and try again.' };

    const seats = plan.seatBased ? Math.min(999, Math.max(1, Math.floor(seatsInput))) : 1;
    const creditsPerPeriod = (plan.creditsPerMonth ?? 0) * (interval === 'year' ? 12 : 1);

    const [existing, email, hdrs] = await Promise.all([
      getOrgSubscription(org.orgId),
      currentUserEmail(),
      headers()
    ]);
    const origin = resolveSiteOrigin(hdrs);
    const stripe = new Stripe(secretKey);

    const metadata = {
      org_id: org.orgId,
      plan: plan.id,
      billing_interval: interval,
      seats: String(seats),
      credits_per_period: String(creditsPerPeriod)
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: org.orgId,
      ...(existing.stripeCustomerId
        ? { customer: existing.stripeCustomerId }
        : email
          ? { customer_email: email }
          : {}),
      line_items: [
        {
          quantity: seats,
          price_data: {
            currency: 'usd',
            unit_amount: unitAmount,
            recurring: { interval },
            product_data: {
              name: `FundExecs ${plan.name}`,
              description: plan.tagline
            }
          }
        }
      ],
      subscription_data: { metadata },
      metadata,
      success_url: `${origin}/settings?plan=success#billing`,
      cancel_url: `${origin}/settings?plan=cancel#billing`
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

/**
 * createCustomTopUpCheckout — one-off purchase of a custom credit pack. The
 * caller picks a dollar amount; credits are granted at CREDITS_PER_DOLLAR by
 * the webhook on `checkout.session.completed`.
 */
export async function createCustomTopUpCheckout(
  dollars: CreditPackDollars
): Promise<CheckoutResult> {
  if (!isValidCreditPack(dollars)) {
    return { ok: false, error: 'Invalid credit amount selected.' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { ok: false, error: NOT_CONFIGURED };

  try {
    const org = await getActiveOrg();
    if (!org) return { ok: false, error: 'No active workspace — sign in and try again.' };

    const amountCents = dollars * 100;
    const credits = dollars * CREDITS_PER_DOLLAR;

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
            unit_amount: amountCents,
            product_data: {
              name: `${credits.toLocaleString()} FundExecs credits`,
              description: 'Credit top-up for your FundExecs OS workspace.'
            }
          }
        }
      ],
      metadata: {
        org_id: org.orgId,
        amount_credits: String(credits),
        amount_cents: String(amountCents)
      },
      success_url: `${origin}/settings?topup=success#billing`,
      cancel_url: `${origin}/settings?topup=cancel#billing`
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

/**
 * createBillingPortalSession — open the Stripe Customer Portal so the operator
 * can change plan, update card, or cancel. Requires an existing Stripe customer
 * (i.e. a prior subscription).
 */
export async function createBillingPortalSession(): Promise<CheckoutResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { ok: false, error: NOT_CONFIGURED };

  try {
    const org = await getActiveOrg();
    if (!org) return { ok: false, error: 'No active workspace — sign in and try again.' };

    const sub = await getOrgSubscription(org.orgId);
    if (!sub.stripeCustomerId) {
      return { ok: false, error: 'No billing account yet — choose a plan to get started.' };
    }

    const hdrs = await headers();
    const origin = resolveSiteOrigin(hdrs);
    const stripe = new Stripe(secretKey);

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${origin}/settings#billing`
    });
    return { ok: true, url: session.url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not open billing. Please try again.'
    };
  }
}
