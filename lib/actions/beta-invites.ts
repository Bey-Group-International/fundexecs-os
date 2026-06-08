'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { requirePlatformAdmin } from '@/lib/access.server';
import { getSiteURL } from '@/lib/site-url';
import type { Database, Json } from '@/lib/supabase/database.types';

export type InviteResult = { ok: true; link: string; email: string } | { ok: false; error: string };

export type InviteActionResult = { ok: true } | { ok: false; error: string };
export type DeleteInviteResult = { ok: true } | { ok: false; error: string };
type InviteRole = Database['public']['Enums']['org_member_role'];

/** New beta users land in onboarding after the link verifies. */
const INVITE_NEXT_PATH = '/onboarding';

/** Conservative email shape check — the Supabase API is the real validator. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse an optional admin note into a role + human note. A leading
 * `role: owner|admin|member` token sets the invited member's role (defaulting
 * to `member`); the remaining text becomes the free-form note.
 */
function parseInviteRole(note?: string): { role: InviteRole; note: string | null } {
  const trimmed = note?.trim() ?? '';
  if (!trimmed) return { role: 'member', note: null };

  const match = /^role:\s*(owner|admin|member)\b/i.exec(trimmed);
  if (!match) return { role: 'member', note: trimmed };

  const role = match[1].toLowerCase() as InviteRole;
  const humanNote = trimmed
    .slice(match[0].length)
    .replace(/^[^A-Za-z0-9]+/, '')
    .trim();

  return { role, note: humanNote || null };
}

/** Append a row to `admin_actions` recording a beta-invite action (best-effort; never blocks). */
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
async function mintInviteLink(
  email: string,
  inviteId: string
): Promise<{ link: string } | { error: string }> {
  const admin = createAdminClient();
  const redirectTo = `${getSiteURL()}/auth/confirm`;

  const buildLink = (hashedToken: string, verificationType: string): string => {
    const url = new URL(`${getSiteURL()}/auth/confirm`);
    url.searchParams.set('token_hash', hashedToken);
    url.searchParams.set('type', verificationType);
    url.searchParams.set('invite_id', inviteId);
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
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
  }

  const supabase = await createClient();
  const now = new Date().toISOString();
  const invite = parseInviteRole(note);
  // Upsert on (org_id, lower(email)): a re-invite refreshes the row and
  // re-arms it to pending without losing the original invited_at.
  const { data, error } = await supabase
    .from('beta_invites')
    .upsert(
      {
        org_id: org.orgId,
        email,
        role: invite.role,
        note: invite.note,
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

  const minted = await mintInviteLink(email, data.id);
  if ('error' in minted) return { ok: false, error: minted.error };

  await writeAudit(org.orgId, org.userId, 'invite_beta_user', data.id, {
    email,
    role: invite.role
  });
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
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
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

  const minted = await mintInviteLink(invite.email, inviteId);
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
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
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

/**
 * Permanently delete a beta invite. Admin-gated. Guardrail: an invite that was
 * already accepted (the user joined) is NOT deletable — deleting it would erase
 * the record that they came in this way. Revoke a pending invite or just leave
 * an accepted one; delete is for cleaning up pending/revoked typos.
 */
export async function deleteBetaInvite(inviteId: string): Promise<DeleteInviteResult> {
  if (!inviteId) return { ok: false, error: 'Missing invite id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'This action is reserved for the Bey Group team.' };
  }

  const admin = createAdminClient();
  const { data: invite, error: readErr } = await admin
    .from('beta_invites')
    .select('status')
    .eq('id', inviteId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!invite) return { ok: false, error: 'Invite not found.' };
  if (invite.status === 'accepted') {
    return { ok: false, error: 'This person already joined — their invite can’t be deleted.' };
  }

  // Guard the accepted check atomically: `.neq('status','accepted')` means a
  // status that flips to accepted between the read above and here deletes 0 rows
  // rather than erasing the record that they joined.
  const { data: deleted, error } = await admin
    .from('beta_invites')
    .delete()
    .eq('id', inviteId)
    .eq('org_id', org.orgId)
    .neq('status', 'accepted')
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!deleted) {
    return { ok: false, error: 'This person already joined — their invite can’t be deleted.' };
  }

  await writeAudit(org.orgId, org.userId, 'delete_beta_invite', inviteId);
  return { ok: true };
}
