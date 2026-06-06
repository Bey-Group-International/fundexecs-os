import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/queries/auth';

/**
 * Resolve the signed-in user's active organization. We pick the first
 * `org_members` row for `auth.uid()`. Returns `null` when there is no
 * authenticated user or no membership yet (callers should render an
 * empty / no-org state rather than throwing).
 */
export async function getActiveOrg(): Promise<{
  userId: string;
  orgId: string;
} | null> {
  const supabase = await createClient();

  const user = await getAuthUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return { userId: user.id, orgId: data.org_id };
}
