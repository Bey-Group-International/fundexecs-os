'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { getSiteURL } from '@/lib/site-url';
import type { Database } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/actions/organization.ts — owner/admin-scoped Organization settings.
 *
 * Distinct from the platform Admin section (which is gated to the Bey Group
 * team). These actions let a workspace OWNER/ADMIN manage their own org:
 * identity (name/type/description/website/logo), team (invite / role / remove),
 * ownership transfer, leaving, and deletion. Authorization is enforced by the
 * existing RLS (`private.is_org_admin` on organizations/org_members/beta_invites)
 * plus an explicit actor-role check; destructive self-actions that RLS can't
 * express use the service-role client behind a verified guard.
 * ========================================================================= */

type OrgType = Database['public']['Enums']['org_type'];
type OrgMemberRole = Database['public']['Enums']['org_member_role'];

export interface OrgActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
  /** Set by inviteOrgMember — the magic link to share with the invitee. */
  link?: string;
}

const ORG_TYPES: OrgType[] = [
  'fund',
  'lp',
  'operator',
  'capital_provider',
  'service_provider',
  'partner'
];
const ROLES: OrgMemberRole[] = ['owner', 'admin', 'member'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const INVITE_NEXT_PATH = '/beta/welcome';

function ok(message: string, extra?: Partial<OrgActionState>): OrgActionState {
  return { status: 'success', message, ...extra };
}
function err(message: string): OrgActionState {
  return { status: 'error', message };
}
function cleanStr(value: FormDataEntryValue | null, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}
function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** Resolve the caller's role in the active org, or an error result. */
async function resolveActor(): Promise<
  { ok: true; orgId: string; userId: string; role: OrgMemberRole } | { ok: false; error: string }
> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'Create or join a workspace first.' };
  const supabase = await createClient();
  const { data } = await supabase
    .from('org_members')
    .select('role, status')
    .eq('org_id', org.orgId)
    .eq('user_id', org.userId)
    .maybeSingle();
  if (!data || data.status !== 'active') {
    return { ok: false, error: 'You are not an active member of this workspace.' };
  }
  return { ok: true, orgId: org.orgId, userId: org.userId, role: data.role };
}

/* ---------------------------------------------------------------------------
 * Identity — name / type / description / website
 * ------------------------------------------------------------------------- */

export async function updateOrgProfile(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const actor = await resolveActor();
  if (!actor.ok) return err(actor.error);
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    return err('Only workspace owners and admins can edit organization details.');
  }

  const name = cleanStr(formData.get('orgName'), 120);
  if (!name) return err('Organization name is required.');
  const type = formData.get('orgType');
  if (typeof type !== 'string' || !ORG_TYPES.includes(type as OrgType)) {
    return err('Choose a valid organization type.');
  }
  const description = cleanStr(formData.get('description'), 280);
  const website = normalizeUrl(cleanStr(formData.get('website'), 200));

  const supabase = await createClient();
  const { error } = await supabase
    .from('organizations')
    .update({ name, type: type as OrgType, description, website })
    .eq('id', actor.orgId);
  if (error) return err(error.message);

  revalidatePath('/settings');
  revalidatePath('/', 'layout');
  return ok('Organization details saved.');
}

/* ---------------------------------------------------------------------------
 * Logo — reuse the public `avatars` bucket under the uploader's folder
 * ------------------------------------------------------------------------- */

export async function updateOrgLogo(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const actor = await resolveActor();
  if (!actor.ok) return err(actor.error);
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    return err('Only workspace owners and admins can change the logo.');
  }

  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) return err('Choose an image to upload.');
  if (!file.type.startsWith('image/')) return err('That file is not an image.');
  if (file.size > MAX_LOGO_BYTES) return err('Image must be 5 MB or smaller.');

  const supabase = await createClient();
  const ext =
    (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  // Stored under the uploader's own folder so the existing avatars RLS applies.
  const path = `${actor.userId}/org-logo-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
  if (uploadError) return err(uploadError.message);

  const {
    data: { publicUrl }
  } = supabase.storage.from('avatars').getPublicUrl(path);

  const { error } = await supabase
    .from('organizations')
    .update({ logo_url: publicUrl })
    .eq('id', actor.orgId);
  if (error) return err(error.message);

  revalidatePath('/settings');
  revalidatePath('/', 'layout');
  return ok('Logo updated.');
}

/* ---------------------------------------------------------------------------
 * Team — invite / remove. (Role changes reuse setMemberRole from admin.ts.)
 * ------------------------------------------------------------------------- */

export async function inviteOrgMember(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const actor = await resolveActor();
  if (!actor.ok) return err(actor.error);
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    return err('Only workspace owners and admins can invite teammates.');
  }

  const email = cleanStr(formData.get('email'), 200)?.toLowerCase() ?? '';
  if (!EMAIL_RE.test(email)) return err('Enter a valid email address.');
  const roleInput = formData.get('role');
  const role: OrgMemberRole =
    typeof roleInput === 'string' && ROLES.includes(roleInput as OrgMemberRole)
      ? (roleInput as OrgMemberRole)
      : 'member';
  // Only an owner can mint another owner.
  if (role === 'owner' && actor.role !== 'owner') {
    return err('Only an owner can invite another owner.');
  }

  const supabase = await createClient();
  // Upsert the invite row (RLS: admins manage beta invites). Match on org+email.
  const { data: existing } = await supabase
    .from('beta_invites')
    .select('id')
    .eq('org_id', actor.orgId)
    .eq('email', email)
    .maybeSingle();

  let inviteId: string;
  if (existing?.id) {
    const { error } = await supabase
      .from('beta_invites')
      .update({ role, status: 'pending', last_sent_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return err(error.message);
    inviteId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from('beta_invites')
      .insert({ org_id: actor.orgId, email, role, invited_by: actor.userId })
      .select('id')
      .maybeSingle();
    if (error || !inserted) return err(error?.message ?? 'Could not create the invite.');
    inviteId = inserted.id;
  }

  // Mint a one-time magic link via the service role (token-hash flow → /auth/confirm).
  const mint = await mintInviteLink(email, inviteId);
  if ('error' in mint) return err(mint.error);

  revalidatePath('/settings');
  return ok(`Invite ready for ${email} — copy the link to share it.`, { link: mint.link });
}

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
  // Existing account → passwordless magic link instead.
  const magic = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo }
  });
  if (!magic.error && magic.data.properties) {
    const { hashed_token, verification_type } = magic.data.properties;
    return { link: buildLink(hashed_token, verification_type) };
  }
  return { error: magic.error?.message ?? 'Could not create an invite link.' };
}

/** Remove (archive) a member. Owner/admin only; can't remove an owner. */
export async function removeOrgMember(memberId: string): Promise<OrgActionState> {
  if (!memberId) return err('Missing member id.');
  const actor = await resolveActor();
  if (!actor.ok) return err(actor.error);
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    return err('Only workspace owners and admins can remove members.');
  }

  const supabase = await createClient();
  const { data: target } = await supabase
    .from('org_members')
    .select('role, user_id')
    .eq('id', memberId)
    .eq('org_id', actor.orgId)
    .maybeSingle();
  if (!target) return err('Member not found.');
  if (target.role === 'owner') return err('Transfer ownership before removing an owner.');
  if (target.user_id === actor.userId) return err('Use “Leave workspace” to remove yourself.');

  const { error } = await supabase
    .from('org_members')
    .update({ status: 'archived' })
    .eq('id', memberId)
    .eq('org_id', actor.orgId);
  if (error) return err(error.message);

  revalidatePath('/settings');
  return ok('Member removed.');
}

/* ---------------------------------------------------------------------------
 * Danger zone — transfer ownership / leave / delete
 * ------------------------------------------------------------------------- */

export async function transferOwnership(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const actor = await resolveActor();
  if (!actor.ok) return err(actor.error);
  if (actor.role !== 'owner') return err('Only the current owner can transfer ownership.');

  const newOwnerUserId = cleanStr(formData.get('newOwnerUserId'), 60);
  if (!newOwnerUserId) return err('Choose a member to transfer ownership to.');
  if (newOwnerUserId === actor.userId) return err('You already own this workspace.');

  const supabase = await createClient();
  const { data: target } = await supabase
    .from('org_members')
    .select('id, status')
    .eq('org_id', actor.orgId)
    .eq('user_id', newOwnerUserId)
    .maybeSingle();
  if (!target || target.status !== 'active') return err('That member is not active.');

  // Promote the target, then step down to admin. (RLS: admins manage members.)
  const { error: promoteErr } = await supabase
    .from('org_members')
    .update({ role: 'owner' })
    .eq('org_id', actor.orgId)
    .eq('user_id', newOwnerUserId);
  if (promoteErr) return err(promoteErr.message);

  const { error: demoteErr } = await supabase
    .from('org_members')
    .update({ role: 'admin' })
    .eq('org_id', actor.orgId)
    .eq('user_id', actor.userId);
  if (demoteErr) {
    // Step-down failed — roll the promotion back so we don't leave two owners.
    const { error: rollbackErr } = await supabase
      .from('org_members')
      .update({ role: 'admin' })
      .eq('org_id', actor.orgId)
      .eq('user_id', newOwnerUserId);
    if (rollbackErr) {
      console.error('transferOwnership: demote failed and rollback failed', {
        demoteErr,
        rollbackErr
      });
      return err(
        'Transfer failed and could not be rolled back automatically — please review workspace roles.'
      );
    }
    return err('Transfer failed and was rolled back. Please try again.');
  }

  revalidatePath('/settings');
  return ok('Ownership transferred. You are now an admin.');
}

/** Leave the workspace. Blocked for the sole owner (transfer or delete instead). */
export async function leaveWorkspace(): Promise<OrgActionState> {
  const actor = await resolveActor();
  if (!actor.ok) return err(actor.error);

  if (actor.role === 'owner') {
    const supabase = await createClient();
    const { count } = await supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', actor.orgId)
      .eq('role', 'owner')
      .eq('status', 'active');
    if ((count ?? 0) <= 1) {
      return err('You are the sole owner — transfer ownership or delete the workspace instead.');
    }
  }

  // A plain member can't delete their own org_members row under the
  // admins-manage RLS, so this self-removal runs via the service role, guarded
  // by the verified actor identity above.
  const admin = createAdminClient();
  const { error } = await admin
    .from('org_members')
    .delete()
    .eq('org_id', actor.orgId)
    .eq('user_id', actor.userId);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok('You have left the workspace.');
}

/** Permanently delete the workspace and all its data. Owner-only; typed confirm. */
export async function deleteOrganization(
  _prev: OrgActionState,
  formData: FormData
): Promise<OrgActionState> {
  const actor = await resolveActor();
  if (!actor.ok) return err(actor.error);
  if (actor.role !== 'owner') return err('Only the owner can delete the workspace.');

  const confirm = cleanStr(formData.get('confirm'), 60);
  if (confirm !== 'DELETE') return err('Type DELETE to confirm.');

  // RLS "owners delete their org" allows org admins; we restrict to owner above.
  const supabase = await createClient();
  const { error } = await supabase.from('organizations').delete().eq('id', actor.orgId);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok('Workspace deleted.');
}
