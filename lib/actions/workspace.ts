'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/queries/auth';
import { ACTIVE_ORG_COOKIE } from '@/lib/queries/org';

const ONE_YEAR = 60 * 60 * 24 * 365;

export type SetActiveWorkspaceResult = { ok: true; orgId: string } | { ok: false; error: string };

/**
 * Switch the user's active workspace by pinning the chosen org in the
 * `fx_active_org` cookie. UX state only — RLS owns data access. Membership is
 * re-validated here (the user must be an **active** member of the target org),
 * so this can never grant access to an org the user doesn't belong to. After
 * pinning we `revalidatePath('/')` so the whole shell re-renders against the
 * new active org on the next paint.
 *
 * Additive only: no migration, no middleware, no auth changes.
 */
export async function setActiveWorkspace(orgId: string): Promise<SetActiveWorkspaceResult> {
  const clean = orgId?.trim();
  if (!clean) return { ok: false, error: 'Missing workspace id.' };

  const user = await getAuthUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('org_id', clean)
    .eq('status', 'active')
    .maybeSingle();

  if (!membership) {
    return { ok: false, error: 'You are not an active member of that workspace.' };
  }

  (await cookies()).set(ACTIVE_ORG_COOKIE, clean, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR
  });

  revalidatePath('/');
  return { ok: true, orgId: clean };
}
