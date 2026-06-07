'use server';

import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { getSiteURL } from '@/lib/site-url';
import type { Database, Json } from '@/lib/supabase/database.types';

type OrgMemberRole = Database['public']['Enums']['org_member_role'];

export type BetaLinkResult =
  | { ok: true; link: string; token: string }
  | { ok: false; error: string };
export type RevokeLinkResult = { ok: true } | { ok: false; error: string };
export type ClaimLinkResult = { ok: true; message: string } | { ok: false; error: string };

/** Conservative email shape check — Supabase is the real validator. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRole(input?: string): OrgMemberRole {
  const role = input?.trim().toLowerCase();
  return role === 'owner' || role === 'admin' ? role : 'member';
}

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
 * Generate a shareable, no-email beta link. Admin-gated. Defaults: 25 uses,
 * 14-day expiry. Returns the claim URL to copy and share.
 */
export async function createBetaLink(
  labelInput?: string,
  roleInput?: string,
  maxUsesInput?: number,
  expiryDaysInput?: number
): Promise<BetaLinkResult> {
  const label = labelInput?.trim() || null;
  const role = normalizeRole(roleInput);
  const maxUses = Math.max(1, Math.floor(maxUsesInput || 25));
  const expiryDays = Math.max(1, Math.floor(expiryDaysInput || 14));

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await isOrgAdmin(org.orgId, org.userId))) {
    return { ok: false, error: 'Only owners or admins can create beta links.' };
  }

  // 256-bit url-safe bearer token (a capability, like the magic link itself).
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

  await writeAudit(org.orgId, org.userId, 'create_beta_link', data.id, {
    label,
    role,
    max_uses: maxUses,
    expiry_days: expiryDays
  });

  const link = `${getSiteURL()}/beta/claim?token=${encodeURIComponent(token)}`;
  return { ok: true, link, token };
}

/** Revoke a beta link by ID. Admin-gated. */
export async function revokeBetaLink(linkId: string): Promise<RevokeLinkResult> {
  if (!linkId) return { ok: false, error: 'Missing link id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await isOrgAdmin(org.orgId, org.userId))) {
    return { ok: false, error: 'Only owners or admins can revoke beta links.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('beta_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', linkId)
    .eq('org_id', org.orgId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Beta link not found.' };

  await writeAudit(org.orgId, org.userId, 'revoke_beta_link', linkId);
  return { ok: true };
}

/**
 * Email claim path — public (no session yet). Validates the link is claimable
 * (read-only; never consumes the cap pre-auth), then mints a real Supabase
 * invite magic link. `type: 'invite'` creates the auth user and errors if the
 * email already has an account, so a shared link can't sign a claimer into
 * someone else's account. The returned `/auth/confirm` URL verifies the token
 * and routes to /beta/claim/complete, which records the claim atomically.
 */
export async function claimBetaLinkWithEmail(
  token: string,
  emailInput: string
): Promise<ClaimLinkResult> {
  const email = emailInput.trim().toLowerCase();
  if (!email) return { ok: false, error: 'Email is required.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };

  const admin = createAdminClient();

  // 1) Read-only claimability check (does not touch the claim count).
  const { data: link } = await admin
    .from('beta_links')
    .select('id, max_uses, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!link) return { ok: false, error: 'Invalid link.' };
  if (link.revoked_at) return { ok: false, error: 'This link has been revoked.' };
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'This link has expired.' };
  }
  const { count } = await admin
    .from('beta_link_claims')
    .select('id', { count: 'exact', head: true })
    .eq('beta_link_id', link.id);
  if ((count ?? 0) >= link.max_uses) {
    return { ok: false, error: 'This link has reached its limit.' };
  }

  // 2) Mint a real invite magic link (also enforces the "new account" rule).
  const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo: `${getSiteURL()}/auth/confirm` }
  });
  if (genErr || !gen?.properties) {
    return {
      ok: false,
      error: 'You already have an account — use "Continue with Google" or sign in instead.'
    };
  }

  // 3) Build the token-hash confirm URL → verifies, then records the claim.
  const url = new URL(`${getSiteURL()}/auth/confirm`);
  url.searchParams.set('token_hash', gen.properties.hashed_token);
  url.searchParams.set('type', gen.properties.verification_type);
  url.searchParams.set('next', `/beta/claim/complete?token=${token}`);
  return { ok: true, message: url.toString() };
}
