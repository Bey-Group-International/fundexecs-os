import 'server-only';
import { getAuthUser } from '@/lib/queries/auth';
import { isPlatformAdmin } from '@/lib/access';

/**
 * Server-side platform-admin gate. True when the signed-in user is on the Bey
 * Group team (`@beygroupintl.com`). Admin actions (member management, beta
 * invites & links) across every workspace are reserved for this group,
 * independent of org role. Kept server-only (it reads the auth session) and
 * separate from the isomorphic `isPlatformAdmin` in `lib/access.ts`, which the
 * client UI imports.
 */
export async function requirePlatformAdmin(): Promise<boolean> {
  const user = await getAuthUser();
  return isPlatformAdmin(user?.email);
}
