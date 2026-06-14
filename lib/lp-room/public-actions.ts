'use server';

import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  VIEWS_PER_LINK_CAP,
  normalizeViewerEmail,
  sanitizeViewerName
} from '@/lib/dataroom/persistence';
import { lpRoomTierFromKind } from '@/lib/lp-room/public';

/**
 * lib/lp-room/public-actions.ts — the public `/lp/[token]` route's mutations.
 *
 * Anonymous callers, so every write runs through the service-role client,
 * keyed strictly by the link token (never trusting client-supplied org/tier).
 *
 *  - openPublicLpDocument: mints a short-lived signed URL for a document, but
 *    ONLY after re-resolving the token AND re-checking the document is within
 *    the link's tier (and never admin-only) — fail closed on every branch.
 *  - submitPublicLpQuestion: logs the LP's outreach as a REAL `data_room_views`
 *    row (the same access log the manager reads, which also gates abuse), AND
 *    persists the question body to `lp_room_questions` with a null asker (the
 *    20260614 migration made asked_by nullable + added asker_email) so it shows
 *    up in the manager Q&A for an Earn-drafted answer.
 */

const SIGNED_URL_TTL_SECONDS = 5 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VIEW_COOKIE_DAYS = 7;

export type OpenPublicLpDocumentResult =
  | { ok: true; signedUrl: string }
  | { ok: false; error: string };

export type SubmitPublicLpQuestionResult = { ok: true } | { ok: false; error: string };

/** Resolve a token to its LP-room link, or null. Shared, fail-closed guard. */
async function resolveLink(admin: ReturnType<typeof createAdminClient>, token: string) {
  const { data: link } = await admin
    .from('data_room_links')
    .select('id, org_id, material_kind, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!link) return null;
  const tier = lpRoomTierFromKind(link.material_kind);
  if (!tier) return null;
  if (link.expires_at && Date.parse(link.expires_at) < Date.now()) return null;
  return { id: link.id, orgId: link.org_id, tier };
}

export async function openPublicLpDocument(input: {
  token: string;
  documentId: string;
}): Promise<OpenPublicLpDocumentResult> {
  const token = (input.token ?? '').trim();
  const documentId = (input.documentId ?? '').trim();
  if (!token || token.length > 64) return { ok: false, error: 'This link is not valid.' };
  if (!documentId) return { ok: false, error: 'Missing document.' };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'This room is temporarily unavailable — try again shortly.' };
  }

  try {
    const link = await resolveLink(admin, token);
    if (!link) return { ok: false, error: 'This link is not valid or has expired.' };

    const allowed = link.tier === 'committed' ? ['prospect', 'committed'] : ['prospect'];

    const { data: document } = await admin
      .from('lp_room_documents')
      .select('id, org_id, name, storage_bucket, storage_path, access_level')
      .eq('id', documentId)
      .maybeSingle();

    // The document must belong to the link's org AND sit within the tier.
    // admin-only is excluded by `allowed` — there is no branch that reaches it.
    if (!document || document.org_id !== link.orgId || !allowed.includes(document.access_level)) {
      return { ok: false, error: 'Document not found.' };
    }

    const { data: signed, error: signError } = await admin.storage
      .from(document.storage_bucket)
      .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      return { ok: false, error: 'Could not open the document.' };
    }
    return { ok: true, signedUrl: signed.signedUrl };
  } catch {
    return { ok: false, error: 'This room is temporarily unavailable — try again shortly.' };
  }
}

export async function submitPublicLpQuestion(input: {
  token: string;
  name: string;
  email: string;
  body: string;
}): Promise<SubmitPublicLpQuestionResult> {
  const token = (input.token ?? '').trim();
  const name = sanitizeViewerName(input.name);
  const email = normalizeViewerEmail(input.email);
  const body = (input.body ?? '').replace(/\s+$/g, '').trim().slice(0, 4000);
  if (!token || token.length > 64) return { ok: false, error: 'This link is not valid.' };
  if (!name) return { ok: false, error: 'Enter your name.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email.' };
  if (!body) return { ok: false, error: 'Enter your question.' };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: 'This room is temporarily unavailable — try again shortly.' };
  }

  try {
    const link = await resolveLink(admin, token);
    if (!link) return { ok: false, error: 'This link is not valid or has expired.' };

    // Durable inbound signal: a REAL data_room_views row, deduped per (link,
    // email) and capped per link — identical abuse posture to /dr/[token].
    const now = new Date().toISOString();
    const row = {
      viewer: `${name} · ${email}`,
      viewer_email: email,
      verified_at: now
    };

    const { data: prior } = await admin
      .from('data_room_views')
      .select('id')
      .eq('link_id', link.id)
      .eq('viewer_email', email)
      .maybeSingle();

    if (prior) {
      await admin.from('data_room_views').update(row).eq('id', prior.id);
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
        .insert({ org_id: link.orgId, link_id: link.id, ...row });
      // 23505 = a concurrent submit won the race; their row stands.
      if (error && error.code !== '23505') {
        return { ok: false, error: 'Could not send your question — try again.' };
      }
    }

    // Persist the question body itself (anonymous asker — no profile) so the
    // manager sees the real question in the LP Room Q&A. Service role bypasses
    // the member-only insert policy; asked_by is null since the LP isn't a user.
    const { error: questionError } = await admin.from('lp_room_questions').insert({
      org_id: link.orgId,
      asked_by: null,
      asker_name: name,
      asker_email: email,
      body,
      status: 'open'
    });
    if (questionError) {
      return { ok: false, error: 'Could not send your question — try again.' };
    }

    (await cookies()).set(`fx_lp_${link.id}`, encodeURIComponent(name), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/lp',
      maxAge: 60 * 60 * 24 * VIEW_COOKIE_DAYS
    });

    return { ok: true };
  } catch {
    return { ok: false, error: 'This room is temporarily unavailable — try again shortly.' };
  }
}
