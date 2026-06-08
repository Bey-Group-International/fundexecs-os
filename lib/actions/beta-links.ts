'use server';

import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { requirePlatformAdmin } from '@/lib/access.server';
import { isPlatformAdmin } from '@/lib/access';
import { getSiteURL } from '@/lib/site-url';
import type { Database, Json } from '@/lib/supabase/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

/** ~100 years — effectively permanent, reversible by setting ban_duration 'none'. */
const SUSPEND_DURATION = '876000h';

type OrgMemberRole = Database['public']['Enums']['org_member_role'];

export type BetaLinkResult =
  | { ok: true; link: string; token: string }
  | { ok: false; error: string };
export type RevokeLinkResult = { ok: true } | { ok: false; error: string };
export type ClaimLinkResult = { ok: true; message: string } | { ok: false; error: string };
export type DeleteLinkResult = { ok: true } | { ok: false; error: string };
export type ReviewResult = { ok: true } | { ok: false; error: string };

type ApplicationReview = 'pending' | 'approved' | 'rejected';

/** Conservative email shape check — Supabase is the real validator. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Coerce free-form role input to a valid org role, defaulting to `member`. */
function normalizeRole(input?: string): OrgMemberRole {
  const role = input?.trim().toLowerCase();
  return role === 'owner' || role === 'admin' ? role : 'member';
}

/** Append a row to `admin_actions` recording a beta-link action (best-effort; never blocks). */
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
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
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
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
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
 * Permanently delete a beta link. Admin-gated. Guardrail: a link that has been
 * claimed by anyone is NOT deletable — those people are in, and the claim rows
 * are the audit trail of who joined through it. Revoke a used link instead.
 * Use delete to clean up links that were never claimed (typos, test links).
 */
export async function deleteBetaLink(linkId: string): Promise<DeleteLinkResult> {
  if (!linkId) return { ok: false, error: 'Missing link id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
  }

  const admin = createAdminClient();

  // Block delete when the link has any claims — keep the join history intact.
  const { count, error: countErr } = await admin
    .from('beta_link_claims')
    .select('id', { count: 'exact', head: true })
    .eq('beta_link_id', linkId)
    .eq('org_id', org.orgId);
  if (countErr) return { ok: false, error: countErr.message };
  if ((count ?? 0) > 0) {
    return { ok: false, error: 'This link has been claimed — revoke it instead of deleting.' };
  }

  const { data, error } = await admin
    .from('beta_links')
    .delete()
    .eq('id', linkId)
    .eq('org_id', org.orgId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Beta link not found.' };

  await writeAudit(org.orgId, org.userId, 'delete_beta_link', linkId);
  return { ok: true };
}

/**
 * Set the review state on a single beta-link application (claim). Observational
 * only — it does not grant or revoke access (the claimant is already in); it is
 * the admin's triage marker. Admin-gated, scoped to the org.
 */
export async function setApplicationReview(
  claimId: string,
  review: ApplicationReview
): Promise<ReviewResult> {
  if (!claimId) return { ok: false, error: 'Missing application id.' };
  if (review !== 'pending' && review !== 'approved' && review !== 'rejected') {
    return { ok: false, error: 'Invalid review state.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
  }

  const admin = createAdminClient();

  // Resolve the claimant AND their prior review state (scoped to the org) so we
  // change access only when it actually differs, and can roll back on failure.
  const { data: claim, error: claimErr } = await admin
    .from('beta_link_claims')
    .select('user_id, review_status')
    .eq('id', claimId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claim) return { ok: false, error: 'Application not found.' };

  // Suspend ⇔ rejected. Only touch the auth account when that bit flips, so a
  // reset from approved→pending never changes access (per the behavior matrix)
  // and re-rejecting is idempotent. Do the access change FIRST so a stored
  // review status never claims a suspension that didn't actually take.
  const wasSuspended = claim.review_status === 'rejected';
  const shouldSuspend = review === 'rejected';
  const accessChanged = wasSuspended !== shouldSuspend;
  if (accessChanged) {
    const suspend = await setApplicantSuspended(admin, claim.user_id, shouldSuspend);
    if (!suspend.ok) return suspend;
  }

  const { data, error } = await admin
    .from('beta_link_claims')
    .update({
      review_status: review,
      // Clear the audit stamp when sent back to pending; set it otherwise.
      reviewed_at: review === 'pending' ? null : new Date().toISOString(),
      reviewed_by: review === 'pending' ? null : org.userId
    })
    .eq('id', claimId)
    .eq('org_id', org.orgId)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    // Status write failed after we changed the ban — compensate by restoring the
    // prior suspension state so the account and the (unchanged) status agree.
    if (accessChanged) {
      await setApplicantSuspended(admin, claim.user_id, wasSuspended);
    }
    return { ok: false, error: error?.message ?? 'Application not found.' };
  }

  await writeAudit(org.orgId, org.userId, `review_beta_application_${review}`, claimId, {
    suspended: review === 'rejected'
  });
  return { ok: true };
}

/**
 * Suspend or restore a beta applicant's auth account by toggling the Supabase
 * GoTrue ban. Suspended users cannot sign in anywhere. Safety rail: a Bey Group
 * team member (platform admin) is never suspended, so an admin can't lock out a
 * teammate (or themselves) through the inbox. Restoring a team member is a no-op.
 */
async function setApplicantSuspended(
  admin: SupabaseClient<Database>,
  userId: string,
  suspend: boolean
): Promise<ReviewResult> {
  const { data: target, error: readErr } = await admin.auth.admin.getUserById(userId);
  if (readErr || !target?.user) {
    return { ok: false, error: 'Could not load the applicant account.' };
  }
  if (isPlatformAdmin(target.user.email)) {
    return suspend
      ? { ok: false, error: 'This is a Bey Group team member and can’t be suspended.' }
      : { ok: true };
  }

  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: suspend ? SUSPEND_DURATION : 'none'
  });
  if (error) return { ok: false, error: error.message };
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
