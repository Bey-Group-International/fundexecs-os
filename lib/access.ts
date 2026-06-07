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
 */
export const PLATFORM_ADMIN_DOMAIN = '@beygroupintl.com';

/** True when `email` belongs to the Bey Group team domain. */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(PLATFORM_ADMIN_DOMAIN);
}
