'use server';

import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';
import { getSiteURL } from '@/lib/site-url';

/* ============================================================================
 * lib/actions/profile-share.ts — mint / revoke the shareable Profile link.
 *
 * Create + revoke run through the authed server client, so the RLS policy
 * ("owners manage profile shares" → private.is_org_admin) is the gate: only an
 * org owner/admin can mint a link for their workspace's Profile. The public
 * read path (/p/<token>) is separate and uses the service-role admin client.
 * ========================================================================= */

export type ShareLinkResult =
  | { ok: true; url: string; token: string }
  | { ok: false; error: string };

export type RevokeShareResult = { ok: true } | { ok: false; error: string };

function shareUrl(token: string): string {
  return `${getSiteURL()}/p/${token}`;
}

/**
 * Return the workspace's live public Profile link, minting one if needed.
 * Reuses an existing non-revoked, non-expired link so the URL is stable.
 */
export async function createProfileShareLink(): Promise<ShareLinkResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();

  // Reuse a live link if one exists (RLS scopes this to org owners/admins).
  const { data: existing } = await supabase
    .from('member_profile_shares')
    .select('token, expires_at')
    .eq('org_id', org.orgId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    existing?.token &&
    (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now())
  ) {
    return { ok: true, url: shareUrl(existing.token), token: existing.token };
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const user = await getAuthUser();
  const { error } = await supabase
    .from('member_profile_shares')
    .insert({ org_id: org.orgId, token, created_by: user?.id ?? null });

  if (error) {
    return {
      ok: false,
      error: 'Only a workspace owner or admin can create a share link.'
    };
  }
  return { ok: true, url: shareUrl(token), token };
}

/** Revoke a share link by token (owner/admin only, RLS-enforced). */
export async function revokeProfileShareLink(token: string): Promise<RevokeShareResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('member_profile_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('org_id', org.orgId)
    .eq('token', token)
    .is('revoked_at', null);

  if (error) return { ok: false, error: 'Could not revoke the link.' };
  return { ok: true };
}
