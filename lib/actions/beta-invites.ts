'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { getSiteURL } from '@/lib/site-url';
import type { Json } from '@/lib/supabase/database.types';

export type InviteResult = { ok: true; link: string; email: string } | { ok: false; error: string };

export type InviteActionResult = { ok: true } | { ok: false; error: string };

/** New beta users land in onboarding after the link verifies. */
const INVITE_NEXT_PATH = '/onboarding';

/** Conservative email shape check — the Supabase API is the real validator. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      target_type: 'beta_invite',
      target_id: targetId,
      metadata: metadata as Json
    });
  } catch {
    // Audit is best-effort — never block the primary action.
  }
}

/**
 * Mint a one-time magic invite link for `email`.
 *
 * We build the link from the `hashed_token` (token-hash flow) rather than
 * the raw GoTrue `action_link`. The token-hash flow is verified server-side
 * by /auth/confirm via `verifyOtp`, which needs no PKCE code-verifier — the
 * verifier the browser-side flow strands when a link is opened cold from an
 * email (the same failure mode the Google callback works around).
 *
 * Fresh emails use the `invite` link type (which also creates the auth user,
 * firing `handle_new_user` to provision their org). Already-registered emails
 * fall back to `magiclink` so re-invites / resends still produce a working
 * sign-in link.
 */
async function mintInviteLink(email: string): Promise<{ link: string } | { error: string }> {
  const admin = createAdminClient();
  const redirectTo = `${getSiteURL()}/auth/confirm`;

  const buildLink = (hashedToken: string, verificationType: string): string => {
    const url = new URL(`${getSiteURL()}/auth/confirm`);
    url.searchParams.set('token_hash', hashedToken);
    url.searchParams.set('type', verificationType);
    url.searchParams.set('next', INVITE_NEXT_PATH);
    return url.toString();
  };

  const invite = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo }
  });

  if (!invite.error && invite.data.properties) {
    const { hashed_token, verification_type } = invite.data.properties;
    return { link: buildLink(hashed_token, verification_type) };
  }

  // Most commonly: the email already has an account. Fall back to a
  // passwordless magic-link sign-in for the existing user.
  const magic = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo }
  });

  if (!magic.error && magic.data.properties) {
    const { hashed_token, verification_type } = magic.data.properties;
    return { link: buildLink(hashed_token, verification_type) };
  }

  return {
    error: magic.error?.message ?? invite.error?.message ?? 'Could not generate an invite link.'
  };
}

/**
 * Invite a beta user by email. Mints a magic link, records (or refreshes) the
 * tracked invite row, and returns the link for the admin to copy and share.
 */
export async function inviteBetaUser(emailInput: string, note?: string): Promise<InviteResult> {
  const email = emailInput.trim().toLowerCase();
  if (!email) return { ok: false, error: 'Email is required.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await isOrgAdmin(org.orgId, org.userId))) {
    return { ok: false, error: 'Only owners or admins can invite beta users.' };
  }

  const minted = await mintInviteLink(email);
  if ('error' in minted) return { ok: false, error: minted.error };

  const supabase = await createClient();
  const now = new Date().toISOString();
  // Upsert on (org_id, lower(email)): a re-invite refreshes the row and
  // re-arms it to pending without losing the original invited_at.
  const { data, error } = await supabase
    .from('beta_invites')
    .upsert(
      {
        org_id: org.orgId,
        email,
        note: note?.trim() || null,
        invited_by: org.userId,
        status: 'pending',
        last_sent_at: now,
        accepted_at: null
      },
      { onConflict: 'org_id,email' }
    )
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Could not record the invite.' };
  }

  await writeAudit(org.orgId, org.userId, 'invite_beta_user', data.id, { email });
  return { ok: true, link: minted.link, email };
}

/**
 * Regenerate a fresh magic link for an existing pending invite and bump its
 * `last_sent_at`. Returns the new link to copy.
 */
export async function resendBetaInvite(inviteId: string): Promise<InviteResult> {
  if (!inviteId) return { ok: false, error: 'Missing invite id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await isOrgAdmin(org.orgId, org.userId))) {
    return { ok: false, error: 'Only owners or admins can resend invites.' };
  }

  const supabase = await createClient();
  const { data: invite, error: readErr } = await supabase
    .from('beta_invites')
    .select('email, status')
    .eq('id', inviteId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!invite) return { ok: false, error: 'Invite not found.' };

  const minted = await mintInviteLink(invite.email);
  if ('error' in minted) return { ok: false, error: minted.error };

  const { error } = await supabase
    .from('beta_invites')
    .update({ status: 'pending', last_sent_at: new Date().toISOString(), accepted_at: null })
    .eq('id', inviteId)
    .eq('org_id', org.orgId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(org.orgId, org.userId, 'resend_beta_invite', inviteId, { email: invite.email });
  return { ok: true, link: minted.link, email: invite.email };
}

/** Revoke an invite. The magic link can no longer be re-minted from the UI. */
export async function revokeBetaInvite(inviteId: string): Promise<InviteActionResult> {
  if (!inviteId) return { ok: false, error: 'Missing invite id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await isOrgAdmin(org.orgId, org.userId))) {
    return { ok: false, error: 'Only owners or admins can revoke invites.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('beta_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .eq('org_id', org.orgId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(org.orgId, org.userId, 'revoke_beta_invite', inviteId);
  return { ok: true };
}
