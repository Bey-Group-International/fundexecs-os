import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/queries/auth';

/**
 * Cookie that pins the user's chosen active workspace. UX state only — RLS still
 * owns data access, and `getActiveOrg` re-validates the cookie's org against the
 * user's active memberships on every read, so a stale or forged value silently
 * falls back to the first membership.
 */
export const ACTIVE_ORG_COOKIE = 'fx_active_org';

/**
 * Resolve the signed-in user's active organization.
 *
 * Preference order:
 *  1. The org pinned by the `fx_active_org` cookie — but only if the user is
 *     still an **active** member of it (re-checked against `org_members` here,
 *     so the cookie can never escalate access).
 *  2. The first `org_members` row for `auth.uid()` (stable, created_at order).
 *
 * Returns `null` when there is no authenticated user or no membership yet
 * (callers should render an empty / no-org state rather than throwing).
 */
export async function getActiveOrg(): Promise<{
  userId: string;
  orgId: string;
} | null> {
  const supabase = await createClient();

  const user = await getAuthUser();

  if (!user) return null;

  // Honor the pinned workspace cookie when it names an org the user is an
  // active member of. We validate membership rather than trusting the cookie.
  const pinned = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  if (pinned) {
    const { data: pinnedRow } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('org_id', pinned)
      .eq('status', 'active')
      .maybeSingle();
    if (pinnedRow) return { userId: user.id, orgId: pinnedRow.org_id };
  }

  const { data, error } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return { userId: user.id, orgId: data.org_id };
}
