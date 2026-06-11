import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/queries/auth';
import type { Database } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/queries/settings.ts — the reads behind /settings.
 *
 * Account = the viewer's `profiles` row + auth email. Workspace = the active
 * org's `organizations` row. Both RLS-scoped; both degrade to null so the page
 * can render honest empty states instead of throwing.
 * ========================================================================= */

export type OrgType = Database['public']['Enums']['org_type'];

export interface AccountProfile {
  name: string;
  role: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface WorkspaceProfile {
  name: string;
  type: OrgType | null;
  description: string | null;
  website: string | null;
  logoUrl: string | null;
  tier: string | null;
}

/** The viewer's account profile (name / role / email / avatar). */
export async function getAccountProfile(userId: string): Promise<AccountProfile | null> {
  try {
    const supabase = await createClient();
    const user = await getAuthUser();

    const { data } = await supabase
      .from('profiles')
      .select('full_name, role, avatar_url')
      .eq('id', userId)
      .maybeSingle();

    return {
      name: data?.full_name?.trim() || '',
      role: data?.role?.trim() || '',
      email: user?.email ?? null,
      avatarUrl: data?.avatar_url ?? null
    };
  } catch {
    return null;
  }
}

/** The active workspace's organization row, for Settings → Workspace. */
export async function getWorkspaceProfile(orgId: string): Promise<WorkspaceProfile | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('organizations')
      .select('name, type, description, website, logo_url, tier')
      .eq('id', orgId)
      .maybeSingle();
    if (!data) return null;
    return {
      name: data.name,
      type: data.type,
      description: data.description,
      website: data.website,
      logoUrl: data.logo_url,
      tier: data.tier
    };
  } catch {
    return null;
  }
}
