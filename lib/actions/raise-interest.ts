'use server';

import { createAdminClient } from '@/lib/supabase/admin';

/* ============================================================================
 * lib/actions/raise-interest.ts — public "express interest" submission.
 *
 * Called from the unauthenticated public raise page (/r/<token>). There is no
 * session here, so the write goes through the service-role admin client after
 * the token is validated (active, not revoked, not expired) — mirroring the
 * member_profile_shares / beta_links public-write pattern. The matching
 * `raise_interests` table has NO authenticated insert policy; capture happens
 * exclusively on this trusted server path.
 *
 * Per the W1 decision, this is lead-gen only ("express interest"), not a money
 * movement — no payment is taken here. A notification is fanned out to the org
 * owner/admins so the lead lands in their inbox for triage.
 * ========================================================================= */

export type RaiseInterestResult = { ok: true } | { ok: false; error: string };

const NAME_MAX = 120;
const EMAIL_MAX = 254;
const NOTE_MAX = 1000;
// Defensive upper bound so a fat-fingered / hostile amount can't overflow numeric.
const AMOUNT_MAX = 1_000_000_000_000; // $1T

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RaiseInterestInput {
  token: string;
  name: string;
  email: string;
  /** Indicative amount in whole dollars; optional. */
  amount?: number | null;
  note?: string | null;
}

/** Trimmed, length-bounded string (empty → null). */
function clean(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function submitRaiseInterest(input: RaiseInterestInput): Promise<RaiseInterestResult> {
  const token = clean(input.token, 200);
  const name = clean(input.name, NAME_MAX);
  const email = clean(input.email, EMAIL_MAX);
  const note = clean(input.note, NOTE_MAX);

  if (!token || token.length < 16) return { ok: false, error: 'This raise link is invalid.' };
  if (!name) return { ok: false, error: 'Please add your name.' };
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'Please add a valid email.' };

  let amount: number | null = null;
  if (input.amount != null && input.amount !== 0) {
    const n = Number(input.amount);
    if (!Number.isFinite(n) || n < 0 || n > AMOUNT_MAX) {
      return { ok: false, error: 'Please enter a valid amount.' };
    }
    amount = Math.round(n);
  }

  const admin = createAdminClient();

  // Validate the token resolves to a LIVE raise page.
  const { data: page } = await admin
    .from('raise_pages')
    .select('id, org_id, title, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!page || page.revoked_at) return { ok: false, error: 'This raise link is no longer active.' };
  if (page.expires_at && new Date(page.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'This raise link has expired.' };
  }

  // Throttle this public, unauthenticated write so a bot can't spam leads and
  // flood owners with notifications. Keyed by token + email; reuses the generic
  // service-role rate-limiter. Fail-open on infra error so a limiter blip never
  // blocks a legitimate prospect.
  try {
    const { data: allowed } = await admin.rpc('beta_ask_rate_check', {
      _key: `raise_interest:${token}:${email.toLowerCase()}`,
      _window_seconds: 3600,
      _max: 5
    });
    if (allowed === false) {
      return { ok: false, error: 'Too many submissions. Please try again later.' };
    }
  } catch {
    /* fail-open: never block a legitimate submission on a limiter error */
  }

  const { error: insertErr } = await admin.from('raise_interests').insert({
    org_id: page.org_id,
    raise_page_id: page.id,
    name,
    email,
    indicative_amount: amount,
    note
  });

  if (insertErr) return { ok: false, error: 'Could not record your interest. Please try again.' };

  // Fan a notification out to the org's owners/admins (never-block: a notify
  // failure must not fail the prospect's submission).
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
          type: 'raise_interest',
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
    /* never-block: the lead is already recorded */
  }

  return { ok: true };
}
