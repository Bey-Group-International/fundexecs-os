import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type AdminActionRow = Database['public']['Tables']['admin_actions']['Row'];
type BrainRow = Database['public']['Tables']['ai_brains']['Row'];
type OrgMemberRole = Database['public']['Enums']['org_member_role'];

export interface AdminMember {
  id: string;
  userId: string;
  name: string;
  role: OrgMemberRole;
  status: 'Active' | 'Pending';
}

export interface AdminActivity {
  id: string;
  actionType: string;
  targetType: string | null;
  actor: string;
  time: string;
}

export interface AdminBrain {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: 'Global' | 'Org';
}

export interface AdminData {
  members: AdminMember[];
  pendingCount: number;
  actions: AdminActivity[];
  brains: AdminBrain[];
}

const EMPTY: AdminData = { members: [], pendingCount: 0, actions: [], brains: [] };

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Fetch the org's members (joined to profiles), recent admin actions, and the
 * AI brain catalogue (global brains plus this org's brains). RLS-scoped via
 * the server client; query errors degrade to empty collections.
 */
export async function getAdminData(orgId: string): Promise<AdminData> {
  const supabase = await createClient();

  const [membersRes, actionsRes, brainsRes] = await Promise.all([
    supabase
      .from('org_members')
      .select('id, user_id, role, profile:profiles(id, full_name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
    supabase
      .from('admin_actions')
      .select('id, action_type, target_type, created_at, actor:profiles(full_name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('ai_brains')
      .select('id, slug, name, description, is_global, org_id')
      .or(`is_global.eq.true,org_id.eq.${orgId}`)
      .order('is_global', { ascending: false })
      .order('name', { ascending: true })
  ]);

  if (membersRes.error && actionsRes.error && brainsRes.error) return EMPTY;

  type MemberSel = {
    id: string;
    user_id: string;
    role: OrgMemberRole;
    profile: Pick<ProfileRow, 'id' | 'full_name'> | null;
  };
  const members = ((membersRes.data ?? []) as MemberSel[]).map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.profile?.full_name ?? 'Unknown member',
    role: m.role,
    // Owners/admins/members are all active memberships; there is no pending
    // flag in `org_members`, so every persisted row is treated as Active.
    status: 'Active' as const
  }));

  type ActionSel = Pick<AdminActionRow, 'id' | 'action_type' | 'target_type' | 'created_at'> & {
    actor: Pick<ProfileRow, 'full_name'> | null;
  };
  const actions = ((actionsRes.data ?? []) as ActionSel[]).map((a) => ({
    id: a.id,
    actionType: a.action_type,
    targetType: a.target_type,
    actor: a.actor?.full_name ?? 'System',
    time: relativeTime(a.created_at)
  }));

  type BrainSel = Pick<BrainRow, 'id' | 'slug' | 'name' | 'description' | 'is_global'>;
  const brains = ((brainsRes.data ?? []) as BrainSel[]).map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    scope: b.is_global ? ('Global' as const) : ('Org' as const)
  }));

  return {
    members,
    // `org_members` carries no pending state — persisted rows are all active.
    pendingCount: 0,
    actions,
    brains
  };
}
