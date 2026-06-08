'use server';

import Stripe from 'stripe';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteURL } from '@/lib/site-url';

/* ============================================================================
 * lib/actions/raise-reservation.ts — public "reserve" submission for 506(c) raises.
 *
 * Called from the unauthenticated public raise page (/r/<token>) when the owner
 * has enabled accept_reservations=true and the raise is 506(c). Creates a Stripe
 * Checkout session (mode='payment') and records a raise_interests row with
 * kind='reserved'. The Stripe session ID is stored so the webhook can reconcile
 * payment status later.
 *
 * Graceful degradation (never-block): when STRIPE_SECRET_KEY is absent the
 * action still records a reservation intent with reservation_status='intent_only'
 * and returns ok:true with no redirect URL — the UI renders a confirmation
 * instead of a payment redirect. This mirrors the repo's AI/integration pattern.
 *
 * All writes go through the service-role admin client (no authenticated insert
 * policy on raise_interests). Rate-limited like submitRaiseInterest.
 * ========================================================================= */

export type RaiseReservationResult =
  | { ok: true; url: string | null; intentOnly: boolean }
  | { ok: false; error: string };

const NAME_MAX = 120;
const EMAIL_MAX = 254;
const NOTE_MAX = 1000;
const AMOUNT_MAX = 1_000_000_000_000; // $1T
const RESERVATION_MIN = 1; // at least $1

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepted accredited-verification methods (506(c) "reasonable steps"). */
export const VERIFICATION_METHODS = [
  'income',
  'net_worth',
  'professional_license',
  'third_party_letter',
  'other'
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export interface RaiseReservationInput {
  token: string;
  name: string;
  email: string;
  /** Reservation amount in whole dollars. Required. */
  amount: number;
  note?: string | null;
  /** Must be true for 506(c) raises. */
  accredited: boolean;
  /** How the investor will verify accredited status (506(c) reasonable steps). */
  verificationMethod?: string | null;
  /** Optional evidence note or link (e.g. a third-party verification letter URL). */
  verificationEvidence?: string | null;
  /** Storage object path of the uploaded accreditation document, if provided. */
  verificationDocumentPath?: string | null;
}

function clean(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function resolveSiteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  return getSiteURL();
}

export async function submitRaiseReservation(
  input: RaiseReservationInput
): Promise<RaiseReservationResult> {
  const token = clean(input.token, 200);
  const name = clean(input.name, NAME_MAX);
  const email = clean(input.email, EMAIL_MAX);
  const note = clean(input.note, NOTE_MAX);

  if (!token || token.length < 16) return { ok: false, error: 'This raise link is invalid.' };
  if (!name) return { ok: false, error: 'Please add your name.' };
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'Please add a valid email.' };

  const n = Number(input.amount);
  if (!Number.isFinite(n) || n < RESERVATION_MIN || n > AMOUNT_MAX) {
    return { ok: false, error: 'Please enter a valid reservation amount.' };
  }
  const amount = Math.round(n);

  if (!input.accredited) {
    return {
      ok: false,
      error: 'Please confirm you are an accredited investor before reserving.'
    };
  }

  const admin = createAdminClient();

  // Validate the token resolves to a LIVE raise page with reservations enabled.
  const { data: page } = await admin
    .from('raise_pages')
    .select('id, org_id, title, exemption, accept_reservations, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!page || page.revoked_at) return { ok: false, error: 'This raise link is no longer active.' };
  if (page.expires_at && new Date(page.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'This raise link has expired.' };
  }
  if (page.exemption !== '506c') {
    return { ok: false, error: 'Reservations are only available on 506(c) raises.' };
  }
  if (!page.accept_reservations) {
    return { ok: false, error: 'This raise is not accepting reservations.' };
  }

  // Same rate-limit as submitRaiseInterest — fail-open on infra error.
  try {
    const { data: allowed } = await admin.rpc('beta_ask_rate_check', {
      _key: `raise_reservation:${token}:${email.toLowerCase()}`,
      _window_seconds: 3600,
      _max: 5
    });
    if (allowed === false) {
      return { ok: false, error: 'Too many submissions. Please try again later.' };
    }
  } catch {
    /* fail-open */
  }

  const attested_at = new Date().toISOString();

  // Accredited-verification intent: a declared method moves the reservation into
  // 'pending' review; an owner/admin verifies or rejects it later. No method →
  // stays 'unverified' (self-attestation only).
  const vMethodRaw = clean(input.verificationMethod, 60);
  const verificationMethod =
    vMethodRaw && (VERIFICATION_METHODS as readonly string[]).includes(vMethodRaw)
      ? vMethodRaw
      : null;
  const verificationEvidence = clean(input.verificationEvidence, 500);
  const verificationStatus = verificationMethod ? 'pending' : 'unverified';

  // Validate the document path if provided: the first segment must equal the
  // raise page's org_id to prevent a forged path pointing at another org's bucket.
  // On failure we silently drop the path rather than blocking the whole reservation.
  let verificationDocumentPath: string | null = null;
  if (typeof input.verificationDocumentPath === 'string' && input.verificationDocumentPath.trim()) {
    const rawPath = input.verificationDocumentPath.trim();
    const firstSegment = rawPath.split('/')[0];
    if (firstSegment === page.org_id) {
      verificationDocumentPath = rawPath;
    }
  }

  const verificationFields = {
    verification_method: verificationMethod,
    verification_evidence: verificationEvidence,
    verification_status: verificationStatus,
    verification_document_path: verificationDocumentPath
  };

  // Attempt Stripe checkout — degrade gracefully if unconfigured.
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    // Stripe not configured: record a reservation intent without payment.
    const { error: insertErr } = await admin.from('raise_interests').insert({
      org_id: page.org_id,
      raise_page_id: page.id,
      name,
      email,
      indicative_amount: amount,
      note,
      kind: 'reserved',
      accredited: true,
      attested_at,
      reservation_amount: amount,
      reservation_status: 'intent_only',
      stripe_session_id: null,
      ...verificationFields
    });

    if (insertErr) {
      return { ok: false, error: 'Could not record your reservation. Please try again.' };
    }

    await notifyAdmins(admin, page, name, email, amount);
    return { ok: true, url: null, intentOnly: true };
  }

  // Stripe is configured — create a Checkout session.
  try {
    const hdrs = await headers();
    const origin = resolveSiteOriginFromHeaders(hdrs);
    const stripe = new Stripe(secretKey);

    const amountCents = amount * 100;
    const raiseName = (page.title ?? '').trim() || 'FundExecs Raise Reservation';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: `Reservation: ${raiseName}`,
              description:
                'Your reservation deposit for this raise. Not a final investment commitment.'
            }
          }
        }
      ],
      metadata: {
        raise_page_id: page.id,
        org_id: page.org_id,
        investor_name: name,
        investor_email: email,
        reservation_amount: String(amount),
        kind: 'raise_reservation'
      },
      success_url: `${origin}/r/${token}?reservation=success`,
      cancel_url: `${origin}/r/${token}?reservation=cancel`
    });

    if (!session.url) {
      return { ok: false, error: 'Could not start checkout. Please try again.' };
    }

    // Record the reservation row with the Stripe session ID.
    const { error: insertErr } = await admin.from('raise_interests').insert({
      org_id: page.org_id,
      raise_page_id: page.id,
      name,
      email,
      indicative_amount: amount,
      note,
      kind: 'reserved',
      accredited: true,
      attested_at,
      reservation_amount: amount,
      reservation_status: 'pending',
      stripe_session_id: session.id,
      ...verificationFields
    });

    if (insertErr) {
      // Non-fatal: the Stripe session exists, so redirect anyway and let the
      // webhook handle reconciliation on payment.completion.
    }

    await notifyAdmins(admin, page, name, email, amount);
    return { ok: true, url: session.url, intentOnly: false };
  } catch (err) {
    // Stripe call failed — degrade to intent_only.
    const { error: insertErr } = await admin.from('raise_interests').insert({
      org_id: page.org_id,
      raise_page_id: page.id,
      name,
      email,
      indicative_amount: amount,
      note,
      kind: 'reserved',
      accredited: true,
      attested_at,
      reservation_amount: amount,
      reservation_status: 'intent_only',
      stripe_session_id: null,
      ...verificationFields
    });

    if (insertErr) {
      return { ok: false, error: 'Could not record your reservation. Please try again.' };
    }

    await notifyAdmins(admin, page, name, email, amount);
    return { ok: true, url: null, intentOnly: true };
  }
}

/** Resolve origin from request headers, falling back to getSiteURL(). */
function resolveSiteOriginFromHeaders(hdrs: Headers): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host');
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : resolveSiteOrigin();
}

/** Fan notifications to org owners/admins — never-block. */
async function notifyAdmins(
  admin: ReturnType<typeof createAdminClient>,
  page: { id: string; org_id: string; title: string | null },
  name: string,
  email: string,
  amount: number
): Promise<void> {
  try {
    const { data: admins } = await admin
      .from('org_members')
      .select('user_id, role')
      .eq('org_id', page.org_id)
      .eq('status', 'active')
      .in('role', ['owner', 'admin']);

    const recipients = (admins ?? []) as Array<{ user_id: string }>;
    if (recipients.length > 0) {
      await admin.from('notifications').insert(
        recipients.map((r) => ({
          user_id: r.user_id,
          org_id: page.org_id,
          type: 'raise_reservation',
          payload: {
            name,
            email,
            amount,
            raise_title: page.title ?? null,
            raise_page_id: page.id
          }
        }))
      );
    }
  } catch {
    /* never-block */
  }
}
