'use server';

import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * lib/dataroom/public-actions.ts — the public route's one mutation: a viewer
 * passes the vetting gate, and a REAL row lands in `data_room_views` (the
 * same rows the operator's Data Room access bench reads). Anonymous callers,
 * so the write runs through the service-role client, keyed strictly by the
 * link token; a scoped cookie remembers the verification for this browser.
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
  const name = (input.name ?? '').trim().slice(0, 120);
  const email = (input.email ?? '').trim().toLowerCase().slice(0, 200);
  if (!token || token.length > 64) return { ok: false, error: 'This link is not valid.' };
  if (!name) return { ok: false, error: 'Enter your name.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email.' };

  const admin = createAdminClient();
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

  const { error } = await admin.from('data_room_views').insert({
    org_id: link.org_id,
    link_id: link.id,
    viewer: `${name} · ${email}`,
    verified_at: new Date().toISOString()
  });
  if (error) return { ok: false, error: 'Could not record your access — try again.' };

  (await cookies()).set(`fx_dr_${link.id}`, encodeURIComponent(name), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/dr',
    maxAge: 60 * 60 * 24 * VIEW_COOKIE_DAYS
  });

  return { ok: true };
}
