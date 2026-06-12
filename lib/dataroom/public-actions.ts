'use server';

import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { VIEWS_PER_LINK_CAP, normalizeViewerEmail, sanitizeViewerName } from './persistence';

/**
 * lib/dataroom/public-actions.ts — the public route's one mutation: a viewer
 * passes the vetting gate, and a REAL row lands in `data_room_views` (the
 * same rows the operator's Data Room access bench reads). Anonymous callers,
 * so the write runs through the service-role client, keyed strictly by the
 * link token; a scoped cookie remembers the verification for this browser.
 *
 * Abuse posture: one row per (link, email) — repeat verifications refresh
 * the existing row instead of growing the table — and a hard per-link cap
 * so a leaked link can't flood the room.
 */

export type VerifyViewerResult = { ok: true } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VIEW_COOKIE_DAYS = 7;

export async function verifyDataRoomViewer(input: {
  token: string;
  name: string;
  email: string;
  /** The viewer's attestation (accreditation / NDA), required unless vetting is open. */
  attested: boolean;
}): Promise<VerifyViewerResult> {
  const token = (input.token ?? '').trim();
  const name = sanitizeViewerName(input.name);
  const email = normalizeViewerEmail(input.email);
  if (!token || token.length > 64) return { ok: false, error: 'This link is not valid.' };
  if (!name) return { ok: false, error: 'Enter your name.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email.' };

  // Degrade to a calm error on infra failure (e.g. service-role env missing)
  // — an anonymous viewer must never see a 500.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'This room is temporarily unavailable — try again shortly.' };
  }
  // Any rejected admin query (not just the client construction) must degrade to
  // the calm error — the anonymous /dr/[token] viewer must never see a 500.
  try {
    const { data: link } = await admin
      .from('data_room_links')
      .select('id, org_id, vetting, expires_at')
      .eq('token', token)
      .maybeSingle();
    if (!link) return { ok: false, error: 'This link is not valid.' };
    if (link.expires_at && Date.parse(link.expires_at) < Date.now()) {
      return { ok: false, error: 'This link has expired — ask the manager for a fresh one.' };
    }
    if (link.vetting !== 'open' && !input.attested) {
      return { ok: false, error: 'Confirm the attestation to continue.' };
    }

    const now = new Date().toISOString();
    const row = {
      viewer: `${name} · ${email}`,
      viewer_email: email,
      verified_at: now
    };

    // One row per (link, email): a returning viewer refreshes their record.
    const { data: prior } = await admin
      .from('data_room_views')
      .select('id')
      .eq('link_id', link.id)
      .eq('viewer_email', email)
      .maybeSingle();

    if (prior) {
      const { error } = await admin.from('data_room_views').update(row).eq('id', prior.id);
      if (error) return { ok: false, error: 'Could not record your access — try again.' };
    } else {
      const { count } = await admin
        .from('data_room_views')
        .select('id', { count: 'exact', head: true })
        .eq('link_id', link.id);
      if ((count ?? 0) >= VIEWS_PER_LINK_CAP) {
        return {
          ok: false,
          error: 'This link has reached its access limit — ask the manager for a fresh one.'
        };
      }
      const { error } = await admin
        .from('data_room_views')
        .insert({ org_id: link.org_id, link_id: link.id, ...row });
      // 23505 = a concurrent verification of the same email won the race —
      // their row stands; this viewer is still in.
      if (error && error.code !== '23505') {
        return { ok: false, error: 'Could not record your access — try again.' };
      }
    }

    (await cookies()).set(`fx_dr_${link.id}`, encodeURIComponent(name), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/dr',
      maxAge: 60 * 60 * 24 * VIEW_COOKIE_DAYS
    });

    return { ok: true };
  } catch {
    return { ok: false, error: 'This room is temporarily unavailable — try again shortly.' };
  }
}
