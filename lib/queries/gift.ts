import 'server-only';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendGiftEmail } from '@/lib/email/send';
import { getSiteURL } from '@/lib/site-url';

/* ============================================================================
 * lib/queries/gift.ts — read + finalize gift credits.
 *
 * getGiftByCode      — safe public lookup for the claim page (SECURITY DEFINER
 *                      RPC; works for logged-out visitors who hold the code).
 * activateGiftBySession — idempotently flip a paid gift pending→active and send
 *                      the recipient email once. Called by both the Stripe
 *                      webhook and the post-checkout success page.
 * ========================================================================= */

export type GiftStatus = 'pending' | 'active' | 'redeemed' | 'refunded' | 'canceled';

export interface GiftView {
  credits: number;
  amountCents: number;
  senderName: string | null;
  recipientName: string | null;
  message: string | null;
  occasionDate: string | null;
  status: GiftStatus;
}

/** Resolve a gift's safe public details by its redeem code (or null). */
export async function getGiftByCode(code: string): Promise<GiftView | null> {
  if (!code) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_gift_by_code', { _code: code });
    if (error || !data) return null;
    const g = data as Record<string, unknown>;
    return {
      credits: Number(g.credits ?? 0),
      amountCents: Number(g.amount_cents ?? 0),
      senderName: (g.sender_name as string | null) ?? null,
      recipientName: (g.recipient_name as string | null) ?? null,
      message: (g.message as string | null) ?? null,
      occasionDate: (g.occasion_date as string | null) ?? null,
      status: ((g.status as GiftStatus) ?? 'pending') as GiftStatus
    };
  } catch {
    return null;
  }
}

export interface GiftActivation {
  code: string;
  status: GiftStatus;
  credits: number;
  recipientEmail: string | null;
  emailSent: boolean;
}

/**
 * Idempotently activate a paid gift and email the recipient once. Safe to call
 * repeatedly (webhook + success page) — it only flips pending→active and only
 * sends the email when `email_sent_at` is still null.
 */
export async function activateGiftBySession(sessionId: string): Promise<GiftActivation | null> {
  if (!sessionId) return null;
  const admin = createAdminClient();

  const { data: gift } = await admin
    .from('gift_codes')
    .select(
      'id, code, status, credits, recipient_email, recipient_name, sender_name, message, email_sent_at'
    )
    .eq('stripe_session_id', sessionId)
    .maybeSingle();
  if (!gift) return null;

  let status = gift.status as GiftStatus;
  if (status === 'pending') {
    await admin.from('gift_codes').update({ status: 'active' }).eq('id', gift.id);
    status = 'active';
  }

  let emailSent = gift.email_sent_at != null;
  if (status === 'active' && !emailSent && gift.recipient_email) {
    const res = await sendGiftEmail({
      to: gift.recipient_email,
      recipientName: gift.recipient_name,
      senderName: gift.sender_name,
      credits: gift.credits,
      message: gift.message,
      redeemUrl: `${getSiteURL()}/gift/claim?code=${encodeURIComponent(gift.code)}`
    });
    if (res.sent) {
      await admin
        .from('gift_codes')
        .update({ email_sent_at: new Date().toISOString() })
        .eq('id', gift.id);
      emailSent = true;
    }
  }

  return {
    code: gift.code,
    status,
    credits: gift.credits,
    recipientEmail: gift.recipient_email,
    emailSent
  };
}

/**
 * Verify a Checkout Session was paid, then activate its gift. Used by the
 * success page, which can't trust a redirect query param alone. Returns null
 * when Stripe isn't configured, the session isn't paid, or no gift matches.
 */
export async function finalizePaidGift(sessionId: string): Promise<GiftActivation | null> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || !sessionId) return null;
  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') return null;
    return activateGiftBySession(sessionId);
  } catch {
    return null;
  }
}
