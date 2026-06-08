'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { requirePlatformAdmin } from '@/lib/access.server';
import { getSiteURL } from '@/lib/site-url';
import { sendInviteEmail } from '@/lib/email/send';
import type { Database, Json } from '@/lib/supabase/database.types';

/** How the invite link reached the user. 'resend' = our Resend email, 'supabase'
 *  = Supabase's built-in magic-link email, 'none' = neither (admin copies the
 *  link and sends it by hand). */
export type InviteDelivery = 'resend' | 'supabase' | 'none';

export type InviteResult =
  | { ok: true; link: string; email: string; emailed: boolean; via: InviteDelivery }
  | { ok: false; error: string };

export type InviteActionResult = { ok: true } | { ok: false; error: string };
export type DeleteInviteResult = { ok: true } | { ok: false; error: string };
type InviteRole = Database['public']['Enums']['org_member_role'];

/** New beta users land on the post-auth welcome (then onboarding) after the
 *  invite link verifies — a warm, personalized intro before the profile setup. */
const INVITE_NEXT_PATH = '/beta/welcome';

/** Someone who already joined doesn't need the welcome intro again — a re-sent
 *  sign-in link drops them straight back into the app. */
const RETURNING_NEXT_PATH = '/command-center';

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
  inviteId: string,
  next: string = INVITE_NEXT_PATH
): Promise<{ link: string } | { error: string }> {
  const admin = createAdminClient();
  const redirectTo = `${getSiteURL()}/auth/confirm`;

  const buildLink = (hashedToken: string, verificationType: string): string => {
    const url = new URL(`${getSiteURL()}/auth/confirm`);
    url.searchParams.set('token_hash', hashedToken);
    url.searchParams.set('type', verificationType);
    url.searchParams.set('invite_id', inviteId);
    url.searchParams.set('next', next);
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

/** Best-effort display name of the inviting admin, for personalizing the email. */
async function getInviterName(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();
    return data?.full_name?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Deliver the minted invite link to the invitee by email. Tries channels in
 * order and returns the one that succeeded (or 'none'):
 *
 *   1. Resend (via lib/email/send) — emails OUR token-hash link, which verifies
 *      through /auth/confirm and works even when opened cold (no PKCE
 *      code-verifier needed). Reliable + branded; requires RESEND_API_KEY.
 *   2. Supabase built-in — a best-effort fallback that asks Supabase to send its
 *      own magic-link email (`signInWithOtp`). Only sends if the project has
 *      email/SMTP configured, and uses Supabase's template + verify route. The
 *      user already exists here (we just minted a link), so
 *      `shouldCreateUser: false` is correct.
 *
 * Never throws — on total failure the admin still has the copyable link.
 */
async function deliverInviteEmail(opts: {
  email: string;
  link: string;
  inviterName: string | null;
  kind: 'invite' | 'resend';
}): Promise<InviteDelivery> {
  const viaResend = await sendInviteEmail({
    to: opts.email,
    link: opts.link,
    inviterName: opts.inviterName,
    kind: opts.kind
  });
  if (viaResend.sent) return 'resend';

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: opts.email,
      options: { shouldCreateUser: false, emailRedirectTo: `${getSiteURL()}${INVITE_NEXT_PATH}` }
    });
    if (!error) return 'supabase';
  } catch {
    // Fall through to the copyable-link fallback.
  }
  return 'none';
}

/**
 * Invite a beta user by email. Mints a magic link, records (or refreshes) the
 * tracked invite row, emails the link to the invitee, and returns the link as a
 * copyable fallback.
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

  const inviterName = await getInviterName(org.userId);
  const via = await deliverInviteEmail({ email, link: minted.link, inviterName, kind: 'invite' });

  await writeAudit(org.orgId, org.userId, 'invite_beta_user', data.id, {
    email,
    role: invite.role,
    emailDelivery: via
  });
  return { ok: true, link: minted.link, email, emailed: via !== 'none', via };
}

/**
 * Re-send the magic link for an existing invite and re-email it to the invitee.
 *
 * Available on every status so the admin always has a re-send action:
 *  - pending/revoked → re-arm to `pending` (a fresh invitation) and route the
 *    link to the beta welcome intro.
 *  - accepted (already joined) → preserve their accepted state (only bump
 *    `last_sent_at`; never null `accepted_at` or reset to pending) and route the
 *    link to the app home — it's just a passwordless sign-in link, not a
 *    re-invitation. Lets an admin re-send a joined user their way back in.
 *
 * Returns the new link as a fallback the admin can copy if email isn't configured.
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

  const alreadyJoined = invite.status === 'accepted';
  const minted = await mintInviteLink(
    invite.email,
    inviteId,
    alreadyJoined ? RETURNING_NEXT_PATH : INVITE_NEXT_PATH
  );
  if ('error' in minted) return { ok: false, error: minted.error };

  // Joined users keep their accepted state — only bump last_sent_at. Pending /
  // revoked invites are re-armed to pending as a fresh invitation.
  const update = alreadyJoined
    ? { last_sent_at: new Date().toISOString() }
    : { status: 'pending' as const, last_sent_at: new Date().toISOString(), accepted_at: null };
  const { error } = await supabase
    .from('beta_invites')
    .update(update)
    .eq('id', inviteId)
    .eq('org_id', org.orgId);
  if (error) return { ok: false, error: error.message };

  const inviterName = await getInviterName(org.userId);
  const via = await deliverInviteEmail({
    email: invite.email,
    link: minted.link,
    inviterName,
    kind: 'resend'
  });

  await writeAudit(org.orgId, org.userId, 'resend_beta_invite', inviteId, {
    email: invite.email,
    alreadyJoined,
    emailDelivery: via
  });
  return { ok: true, link: minted.link, email: invite.email, emailed: via !== 'none', via };
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
