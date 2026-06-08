'use server';

import crypto from 'crypto';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { getSiteURL } from '@/lib/site-url';
import { creditsForDollars, isValidCreditPack } from '@/lib/billing/credit-packs';

/* ============================================================================
 * lib/actions/gift.ts — buy + redeem gift credits.
 *
 *   createGiftCheckout — public: pay for a credit gift; records a pending
 *     gift_codes row and returns a Stripe Checkout URL. The webhook / success
 *     page activate it and email the recipient.
 *   redeemGift — signed-in: redeem a gift code into the caller's workspace
 *     (atomic, one-time) via the redeem_gift RPC.
 *
 * Env-gated on STRIPE_SECRET_KEY so the page degrades cleanly without billing.
 * ========================================================================= */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOT_CONFIGURED = 'Gifting is not yet enabled on this deployment. Check back soon.';

export interface GiftCheckoutInput {
  amountDollars: number;
  recipientName?: string;
  recipientEmail: string;
  senderName?: string;
  message?: string;
  /** ISO date (yyyy-mm-dd) shown on the gift card; optional. */
  occasionDate?: string;
}

export interface GiftCheckoutResult {
  ok: boolean;
  url?: string;
  error?: string;
}

function clean(value: string | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Create a Stripe Checkout session for a credit gift and record it as pending. */
export async function createGiftCheckout(input: GiftCheckoutInput): Promise<GiftCheckoutResult> {
  const dollars = Math.floor(Number(input.amountDollars));
  if (!isValidCreditPack(dollars)) {
    return { ok: false, error: 'Pick a valid gift amount.' };
  }
  const recipientEmail = input.recipientEmail?.trim().toLowerCase() ?? '';
  if (!EMAIL_RE.test(recipientEmail)) {
    return { ok: false, error: 'Enter a valid recipient email.' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { ok: false, error: NOT_CONFIGURED };

  const occasionDate =
    input.occasionDate && /^\d{4}-\d{2}-\d{2}$/.test(input.occasionDate)
      ? input.occasionDate
      : null;
  const recipientName = clean(input.recipientName, 120);
  const senderName = clean(input.senderName, 120);
  const message = clean(input.message, 600);
  const credits = creditsForDollars(dollars);
  const amountCents = dollars * 100;
  const code = crypto.randomBytes(24).toString('base64url');

  try {
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    const origin = getSiteURL();
    const stripe = new Stripe(secretKey);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(user?.email ? { customer_email: user.email } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: `FundExecs gift — ${credits.toLocaleString()} credits`,
              description: 'A credit gift for a FundExecs OS workspace.'
            }
          }
        }
      ],
      metadata: {
        kind: 'gift',
        gift_code: code,
        amount_credits: String(credits),
        amount_cents: String(amountCents)
      },
      success_url: `${origin}/gift/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/gift?status=cancel`
    });

    if (!session.url) {
      return { ok: false, error: 'Stripe did not return a checkout URL. Please try again.' };
    }

    const admin = createAdminClient();
    const { error } = await admin.from('gift_codes').insert({
      code,
      amount_cents: amountCents,
      credits,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      sender_name: senderName,
      message,
      occasion_date: occasionDate,
      status: 'pending',
      stripe_session_id: session.id,
      purchaser_user_id: user?.id ?? null
    });
    if (error) {
      return { ok: false, error: 'Could not start the gift. Please try again.' };
    }

    return { ok: true, url: session.url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not start checkout. Please try again.'
    };
  }
}

export type RedeemGiftResult =
  | { ok: true; credits: number; balance: number }
  | { ok: false; error: string };

const REDEEM_ERRORS: Record<string, string> = {
  invalid: 'This gift code is not valid.',
  redeemed: 'This gift has already been redeemed.',
  not_active: 'This gift is not ready to redeem yet — check back shortly.'
};

/** Redeem a gift code into the signed-in user's active workspace (one-time). */
export async function redeemGift(code: string): Promise<RedeemGiftResult> {
  const trimmed = code?.trim();
  if (!trimmed) return { ok: false, error: 'Missing gift code.' };

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in to redeem your gift.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace to credit. Finish onboarding first.' };

  const { data, error } = await supabase.rpc('redeem_gift', {
    _code: trimmed,
    _org_id: org.orgId,
    _user_id: user.id
  });
  if (error) return { ok: false, error: 'Could not redeem the gift. Please try again.' };

  const result = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    credits?: number;
    balance?: number;
  };
  if (!result.ok) {
    return { ok: false, error: REDEEM_ERRORS[result.error ?? ''] ?? 'Could not redeem the gift.' };
  }
  return { ok: true, credits: Number(result.credits ?? 0), balance: Number(result.balance ?? 0) };
}
