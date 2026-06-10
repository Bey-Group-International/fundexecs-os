'use server';

import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  RAISING_RANGES,
  type AccessRequestInput,
  type AccessRequestResult
} from '@/lib/landing/access-request';

/* ============================================================================
 * lib/actions/access-request.ts — public "Request access" lead capture.
 *
 * THE single, swappable submission point for the landing page's request-access
 * flow. Every surface (hero modal, /request-access route) routes through
 * `submitAccessRequest()` — to change where leads land (CRM, webhook, email
 * notification), change THIS function only.
 *
 * Today it persists to `public.access_requests`
 * (supabase/migrations/20260610160000_access_requests.sql) via the
 * service-role admin client — the homepage is unauthenticated and the table
 * has no anon grants, mirroring the raise_interests public-write pattern
 * (lib/actions/raise-interest.ts).
 *
 * TODO(team): plug the real CRM / webhook / notification destination in at the
 * marked block below once one is chosen. Do not hardcode secrets — read any
 * endpoint or key from server env vars.
 * ========================================================================= */

const EMAIL_MAX = 254;
const FIELD_MAX = 160;
const CODE_MAX = 64;
const SOURCE_MAX = 64;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Attribution slugs only ('landing-hero', 'request-access-page', …) — the
// action is publicly callable, so a forged request must not be able to persist
// arbitrary attribution strings. Mirrors sanitizeSource in
// app/request-access/page.tsx.
const SOURCE_RE = /^[a-z0-9-]{1,64}$/;

const RANGE_VALUES = new Set<string>(RAISING_RANGES.map((r) => r.value));

/** Trimmed, length-bounded string (empty → null). */
function clean(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function submitAccessRequest(input: AccessRequestInput): Promise<AccessRequestResult> {
  const email = clean(input.email, EMAIL_MAX)?.toLowerCase() ?? null;
  const fullName = clean(input.fullName, FIELD_MAX);
  const firm = clean(input.firm, FIELD_MAX);
  const roleTitle = clean(input.roleTitle, FIELD_MAX);
  const referralCode = clean(input.referralCode, CODE_MAX);
  const rawSource = clean(input.source, SOURCE_MAX);
  const source = rawSource && SOURCE_RE.test(rawSource) ? rawSource : 'landing';

  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Please add a valid work email.' };
  }
  if (!fullName) return { ok: false, error: 'Please add your full name.' };
  if (!firm) return { ok: false, error: 'Please add your firm or fund name.' };
  if (!roleTitle) return { ok: false, error: 'Please add your role or title.' };
  if (!RANGE_VALUES.has(input.raisingRange)) {
    return { ok: false, error: 'Please select what you are raising.' };
  }

  const admin = createAdminClient();

  // Resolve the caller's IP so throttling has a server-observed dimension —
  // an email-only key could be evaded by rotating addresses, or abused to
  // burn a real address's quota.
  let ip: string | null = null;
  try {
    const h = await headers();
    ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || null;
  } catch {
    /* headers unavailable (e.g. unit context) — fall through to email-only */
  }

  // Throttle this public, unauthenticated write so a bot can't spam the lead
  // table: a tight per-email bucket plus a wider per-IP bucket, reusing the
  // generic service-role rate-limiter. Fail-open on infra error so a limiter
  // blip never blocks a real prospect. The IP bucket only applies when a real
  // client IP resolved — keying it on a placeholder would make one shared
  // global bucket that rate-limits every visitor at once.
  const buckets = [{ key: `access_request:email:${email}`, max: 5 }];
  if (ip) {
    buckets.push({ key: `access_request:ip:${ip}`, max: 20 });
  }
  for (const bucket of buckets) {
    try {
      const { data: allowed } = await admin.rpc('beta_ask_rate_check', {
        _key: bucket.key,
        _window_seconds: 3600,
        _max: bucket.max
      });
      if (allowed === false) {
        return { ok: false, error: 'Too many submissions. Please try again later.' };
      }
    } catch {
      /* fail-open: never block a legitimate submission on a limiter error */
    }
  }

  const { error: insertErr } = await admin.from('access_requests').insert({
    email,
    full_name: fullName,
    firm,
    role_title: roleTitle,
    raising_range: input.raisingRange,
    referral_code: referralCode,
    source
  });

  // A repeat submission for the same email is "already on the list", not an
  // error — the visitor gets the same confirmation either way.
  if (insertErr && insertErr.code !== '23505') {
    return { ok: false, error: 'Could not submit your request. Please try again.' };
  }

  // ── Integration point ──────────────────────────────────────────────────────
  // TODO(team): forward the lead to the real CRM / webhook / email notification
  // here once a destination is chosen (read the endpoint from a server env
  // var). The row above is already persisted, so a forwarding failure must
  // never fail the visitor's submission — wrap it in try/catch.
  // ───────────────────────────────────────────────────────────────────────────

  return { ok: true };
}
