import 'server-only';
import { cache } from 'react';
import { getAuthUser } from '@/lib/queries/auth';
import { isPlatformAdmin, canManageOrg, canGrantOwnerRole } from '@/lib/access';
import { createClient } from '@/lib/supabase/server';

/**
 * True only when the error means "the `is_platform_admin` function does not
 * exist yet" — the one rollout window (allowlist migration not applied) where
 * falling back to the domain-only rule is intended. PGRST202 is PostgREST's
 * "function not found"; 42883 is Postgres `undefined_function`. Every other
 * failure (network, timeout, permissions) must fail closed so a transient
 * outage can never re-enable the weaker domain-only gate.
 */
function isRpcMissingError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const msg = (error.message ?? '').toLowerCase();
  return (
    msg.includes('is_platform_admin') &&
    (msg.includes('could not find') || msg.includes('does not exist') || msg.includes('not found'))
  );
}

/**
 * Server-side platform-admin gate — defense in depth, two factors:
 *
 *  1. the signed-in email is on the Bey Group domain (`@beygroupintl.com`), and
 *  2. the email is on the explicit `platform_admins` allowlist, checked via the
 *     `is_platform_admin` RPC (SECURITY DEFINER; reads the caller's own JWT, so
 *     no email argument can probe anyone else's status).
 *
 * Platform-wide actions (beta invites & links, which mint auth users and touch
 * referrals) are reserved for this group, independent of org role. Rollout
 * fail-safe: ONLY when the RPC does not exist yet (allowlist migration not
 * applied) does the gate fall back to the domain-only rule; any other failure
 * fails closed. Memoized per request via React cache.
 */
export const requirePlatformAdmin = cache(async (): Promise<boolean> => {
  const user = await getAuthUser();
  if (!isPlatformAdmin(user?.email)) return false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('is_platform_admin');
    if (error) return isRpcMissingError(error);
    return data === true;
  } catch {
    return false;
  }
});

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
  if (await requirePlatformAdmin()) return true;

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
  if (await requirePlatformAdmin()) return true;

  const supabase = await createClient();
  const { data } = await supabase
    .from('org_members')
    .select('role, status')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle();
  return canGrantOwnerRole(data, false);
}
