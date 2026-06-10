/**
 * Platform-admin access gate.
 *
 * Admin controls (member management, role changes, beta invites & links, the
 * Settings → Admin section) are reserved for the Bey Group team — accounts on
 * the `@beygroupintl.com` domain (pres, vp, secretary, businessdevelopment,
 * etc.) — regardless of a user's role inside their own auto-created org. This is
 * a deliberately strict gate: a normal operator who is "owner" of their own
 * workspace is NOT a platform admin.
 *
 * Pure + isomorphic (no server-only imports) so it can gate both server actions
 * and client UI from one source of truth.
 *
 * NOTE: the domain match below is the cheap FIRST factor only. The server gate
 * (`requirePlatformAdmin` in lib/access.server.ts) additionally requires the
 * email to be on the explicit `platform_admins` allowlist, so a stray account
 * on the domain does not get the portal. Client UI may use this function alone
 * as a display hint; anything that acts must go through the server gate.
 */
export const PLATFORM_ADMIN_DOMAIN = '@beygroupintl.com';

/** True when `email` belongs to the Bey Group team domain. */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(PLATFORM_ADMIN_DOMAIN);
}

/**
 * The minimal membership shape an org-scoped authorization decision needs: the
 * caller's role in the target org and whether that membership is active. `null`
 * means the caller has no membership row in the org at all.
 */
export type OrgMembership = { role: string | null; status: string | null } | null;

/**
 * Pure org-management decision: may a caller with this membership administer the
 * org's team — change roles, approve/archive members, send email invites? True
 * for platform admins, or an ACTIVE `owner`/`admin` of the org. Factored out of
 * the server-only `requireOrgManager` gate so the boundary is unit-testable
 * without a database or auth session.
 */
export function canManageOrg(membership: OrgMembership, isPlatform: boolean): boolean {
  if (isPlatform) return true;
  if (!membership) return false;
  return (
    membership.status === 'active' && (membership.role === 'owner' || membership.role === 'admin')
  );
}

/**
 * Pure owner-grant decision: may a caller with this membership create or grant a
 * new OWNER of the org? True for platform admins or an ACTIVE `owner` only — an
 * `admin` cannot mint owners, which blocks privilege escalation (an admin
 * inviting/promoting someone straight to owner). Mirrors `requireOrgOwner`.
 */
export function canGrantOwnerRole(membership: OrgMembership, isPlatform: boolean): boolean {
  if (isPlatform) return true;
  if (!membership) return false;
  return membership.status === 'active' && membership.role === 'owner';
}
