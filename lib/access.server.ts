import 'server-only';
import { getAuthUser } from '@/lib/queries/auth';
import { isPlatformAdmin, canManageOrg, canGrantOwnerRole } from '@/lib/access';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side platform-admin gate. True when the signed-in user is on the Bey
 * Group team (`@beygroupintl.com`). Platform-wide actions (beta invites & links,
 * which mint auth users and touch referrals) are reserved for this group,
 * independent of org role. Kept server-only (it reads the auth session) and
 * separate from the isomorphic `isPlatformAdmin` in `lib/access.ts`, which the
 * client UI imports.
 */
export async function requirePlatformAdmin(): Promise<boolean> {
  const user = await getAuthUser();
  return isPlatformAdmin(user?.email);
}

/**
 * Org-scoped management gate. True when the signed-in user may administer the
 * members of `orgId`: either a platform admin (Bey Group) OR an ACTIVE
 * owner/admin of that specific org. Powers self-service team management (role
 * changes, archive/approve) so org owners run their own workspace, while the
 * invite/auth-minting flows stay behind `requirePlatformAdmin`.
 *
 * Bounded to a single org id and the caller's own membership, so it can never
 * authorize action on a workspace the user isn't an active owner/admin of.
 */
export async function requireOrgManager(orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const user = await getAuthUser();
  if (!user) return false;
  if (isPlatformAdmin(user.email)) return true;

  const supabase = await createClient();
  const { data } = await supabase
    .from('org_members')
    .select('role, status')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle();
  // Platform admins are handled above; here the decision is purely the
  // caller's membership in this org (unit-tested via canManageOrg).
  return canManageOrg(data, false);
}

/**
 * Owner-grant gate: true when the signed-in user may create a new OWNER of
 * `orgId` — a platform admin OR an ACTIVE owner of that org. Used to stop an
 * org *admin* from escalating privilege by inviting someone in as owner
 * (mirrors the owner-only promotion rule in `setMemberRole`).
 */
export async function requireOrgOwner(orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const user = await getAuthUser();
  if (!user) return false;
  if (isPlatformAdmin(user.email)) return true;

  const supabase = await createClient();
  const { data } = await supabase
    .from('org_members')
    .select('role, status')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle();
  return canGrantOwnerRole(data, false);
}
