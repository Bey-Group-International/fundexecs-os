import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/queries/org-members.ts — the active org's team, for Settings → Organization.
 *
 * Owner/admin-managed (distinct from the platform Admin section). All reads are
 * RLS-scoped: members can see co-members; only owners/admins can read the
 * pending `beta_invites`, so `invites` comes back empty for plain members.
 * ========================================================================= */

export type OrgMemberRole = Database['public']['Enums']['org_member_role'];

export interface OrgTeamMember {
  /** org_members row id (used by role/remove actions). */
  memberId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: OrgMemberRole;
  status: 'active' | 'pending' | 'archived';
}

export interface OrgPendingInvite {
  id: string;
  email: string;
  role: OrgMemberRole;
}

export interface OrgTeam {
  members: OrgTeamMember[];
  invites: OrgPendingInvite[];
  /** The viewer's role in this org, or null when not a member. */
  viewerRole: OrgMemberRole | null;
}

const EMPTY: OrgTeam = { members: [], invites: [], viewerRole: null };

/** Resolve the active org's team (members + pending invites + viewer role). */
export async function getOrgTeam(orgId: string, viewerUserId: string): Promise<OrgTeam> {
  try {
    const supabase = await createClient();

    const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
      supabase
        .from('org_members')
        .select('id, user_id, role, status, profile:profiles(full_name, avatar_url)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true }),
      // Owner/admin-only via RLS; returns [] for plain members.
      supabase
        .from('beta_invites')
        .select('id, email, role, status')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .order('invited_at', { ascending: false })
    ]);

    const members: OrgTeamMember[] = (memberRows ?? [])
      .filter((m) => m.status !== 'archived')
      .map((m) => {
        const profile = (Array.isArray(m.profile) ? m.profile[0] : m.profile) as {
          full_name: string | null;
          avatar_url: string | null;
        } | null;
        return {
          memberId: m.id,
          userId: m.user_id,
          name: profile?.full_name?.trim() || 'Member',
          avatarUrl: profile?.avatar_url ?? null,
          role: m.role,
          status: (m.status as OrgTeamMember['status']) ?? 'active'
        };
      });

    const invites: OrgPendingInvite[] = (inviteRows ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role
    }));

    const viewerRole = members.find((m) => m.userId === viewerUserId)?.role ?? null;

    return { members, invites, viewerRole };
  } catch {
    return EMPTY;
  }
}
