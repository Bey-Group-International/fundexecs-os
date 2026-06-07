'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { getSiteURL } from '@/lib/site-url';
import type { Database, Json } from '@/lib/supabase/database.types';
import crypto from 'crypto';

export type BetaLinkResult =
  | { ok: true; link: string; token: string }
  | { ok: false; error: string };
export type RevokeLinkResult = { ok: true } | { ok: false; error: string };
export type ClaimLinkResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('org_members')
    .select('role, status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return false;
  return (data.role === 'owner' || data.role === 'admin') && data.status === 'active';
}

async function writeAudit(
  orgId: string,
  actorId: string,
  actionType: string,
  targetId: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const supabase = await createClient();
  try {
    await supabase.from('admin_actions').insert({
      org_id: orgId,
      admin_user_id: actorId,
      action_type: actionType,
      target_type: 'beta_link',
      target_id: targetId,
      metadata: metadata as Json
    });
  } catch {
    // Audit is best-effort — never block the primary action.
  }
}

/**
 * Generate a shareable beta link with optional label, role, max uses, and expiry.
 * Defaults: max_uses=25, expiry=14 days.
 */
export async function createBetaLink(
  labelInput?: string,
  roleInput?: string,
  maxUsesInput?: number,
  expiryDaysInput?: number
): Promise<BetaLinkResult> {
  const label = labelInput?.trim() || null;
  const role = (roleInput?.trim().toLowerCase() || 'member') as 'owner' | 'admin' | 'member';
  const maxUses = Math.max(1, maxUsesInput || 25);
  const expiryDays = Math.max(1, expiryDaysInput || 14);

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await isOrgAdmin(org.orgId, org.userId))) {
    return { ok: false, error: 'Only owners or admins can create beta links.' };
  }

  // Generate a random token (32 bytes = 256 bits of entropy).
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('beta_links')
    .insert({
      org_id: org.orgId,
      token,
      label,
      role,
      max_uses: maxUses,
      expires_at: expiresAt,
      created_by: org.userId
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Could not create beta link.' };
  }

  const link = `${getSiteURL()}/beta/claim?token=${encodeURIComponent(token)}`;

  await writeAudit(org.orgId, org.userId, 'create_beta_link', data.id, {
    label,
    role,
    max_uses: maxUses,
    expiry_days: expiryDays
  });

  return { ok: true, link, token };
}

/**
 * Revoke a beta link by ID. Admin-gated.
 */
export async function revokeBetaLink(linkId: string): Promise<RevokeLinkResult> {
  if (!linkId) return { ok: false, error: 'Missing link id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await isOrgAdmin(org.orgId, org.userId))) {
    return { ok: false, error: 'Only owners or admins can revoke beta links.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('beta_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId)
    .eq('org_id', org.orgId);

  if (error) return { ok: false, error: error.message };

  await writeAudit(org.orgId, org.userId, 'revoke_beta_link', linkId);
  return { ok: true };
}

/**
 * Claim a beta link via email. Public (unauthenticated) entry point.
 * Calls claim_beta_link RPC with type:'invite' token flow.
 */
export async function claimBetaLinkWithEmail(
  token: string,
  emailInput: string
): Promise<ClaimLinkResult> {
  const email = emailInput.trim().toLowerCase();
  if (!email) return { ok: false, error: 'Email is required.' };
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return { ok: false, error: 'Enter a valid email address.' };

  const admin = createAdminClient();

  // Call the atomic RPC to verify the link, check the cap/expiry, block existing accounts.
  const { data, error } = await admin.rpc('claim_beta_link', {
    _token: token,
    _user_id: null,
    _email: email
  });

  if (error || !data || !data[0]?.ok) {
    const reason = data?.[0]?.error_reason || error?.message || 'Could not claim link.';
    return { ok: false, error: reason };
  }

  // On success, return a URL to the Supabase Auth signup flow with the email pre-filled
  // and a magic link handler. The consumer routes to /beta/claim/complete to complete signup.
  const confirmUrl = `${getSiteURL()}/auth/confirm?type=invite&token_hash=${encodeURIComponent(token)}&next=${encodeURIComponent('/beta/claim/complete?token=' + token)}&email=${encodeURIComponent(email)}`;

  return { ok: true, message: confirmUrl };
}
