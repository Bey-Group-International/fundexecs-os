import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';

/**
 * The identity the workspace shell renders (sidebar org switcher + user footer,
 * topbar wallet). Name / role / org / email are resolved from Supabase auth +
 * `profiles` + `organizations`. `xp` is read from `profiles.xp`; `level` is
 * derived from it via `xpToLevel`.
 */
/**
 * One organization the signed-in user is an active member of, with their role
 * and the org's tier. Powers the account-menu workspace/role switcher.
 */
export interface ShellMembership {
  orgId: string;
  orgName: string;
  /** The user's role in this org (`owner` | `admin` | `member`). */
  role: string;
  tier: string;
}

export interface ShellIdentity {
  name: string;
  role: string;
  email: string | null;
  orgName: string;
  orgTier: string;
  level: number;
  xp: number;
  /** Unread, non-archived notifications for this user. Drives the topbar
   *  bell badge + sidebar nav badge. */
  unreadCount: number;
  /** Every org the user is an active member of, with their role + the org's
   *  tier. Drives the account-menu workspace/role switcher. The currently
   *  active org is identified by matching `orgId` against the active org. */
  memberships: ShellMembership[];
  /** The active workspace's org id (matches one of `memberships[].orgId` when
   *  the user has any membership). `null` when there is no active org. */
  activeOrgId: string | null;
  /** Profile photo URL — the Google sign-in photo (captured at signup) or an
   *  uploaded avatar. `null` falls back to initials in the UI. */
  avatarUrl: string | null;
}

/**
 * Derive the Earn level from accumulated XP. Level N starts at (N-1)² · 100 XP,
 * so 100→L2, 400→L3, 4 800→L7 — a gentle curve that keeps early wins frequent.
 */
export function xpToLevel(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

/**
 * Resolve the signed-in user's shell identity. Returns `null` when there is no
 * authenticated user; callers fall back to a generic shell identity so the
 * chrome still renders. Real name/role/org are SSR'd so there is no flash.
 */
export async function getShellIdentity(): Promise<ShellIdentity | null> {
  const supabase = await createClient();

  const user = await getAuthUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, xp')
    .eq('id', user.id)
    .maybeSingle();

  const org = await getActiveOrg();
  const activeOrgId = org?.orgId ?? null;

  // Every active membership, joined to the org for name + tier. RLS scopes the
  // rows to orgs the user actually belongs to, so the switcher can only ever
  // offer workspaces the user is authorized for.
  const { data: memberRows } = await supabase
    .from('org_members')
    .select('role, org_id, organizations(id, name, tier)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  type MemberJoin = {
    role: string;
    org_id: string;
    organizations: { id: string; name: string; tier: string | null } | null;
  };
  const memberships = ((memberRows ?? []) as MemberJoin[])
    .filter((m) => m.organizations)
    .map((m) => ({
      orgId: m.org_id,
      orgName: m.organizations?.name || 'Your fund',
      role: m.role || 'member',
      tier: m.organizations?.tier || 'Emerging manager'
    }));

  // The active org's display name/tier + the viewer's role within it. Prefer
  // the membership row (already fetched) so we reuse one round-trip.
  const activeMembership = activeOrgId
    ? (memberships.find((m) => m.orgId === activeOrgId) ?? null)
    : null;
  const orgName: string | null = activeMembership?.orgName ?? null;
  const orgTier: string | null = activeMembership?.tier ?? null;

  const emailHandle = user.email ? user.email.split('@')[0] : null;
  const xp = profile?.xp ?? 0;

  // Profile photo. Read defensively from `profiles.avatar_url` so a deployment
  // where the column migration hasn't run yet can't break the whole identity
  // (a failed/absent column simply yields no photo → initials fallback). The
  // column is populated from the Google sign-in photo at signup and by the
  // Settings avatar uploader.
  let avatarUrl: string | null = null;
  try {
    const { data: avatarRow } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .maybeSingle<{ avatar_url: string | null }>();
    avatarUrl = avatarRow?.avatar_url ?? null;
  } catch {
    avatarUrl = null;
  }

  // Unread, non-archived notifications drive the topbar bell + sidebar
  // nav badge. Computed in the same identity round so every authed page
  // gets the count fresh on each render — paired with revalidatePath in
  // the notifications actions, the badge zeros within a single cycle.
  let unreadCount = 0;
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)
    .is('archived_at', null);
  unreadCount = count ?? 0;

  return {
    name: profile?.full_name || emailHandle || 'Your account',
    role: profile?.role || 'Operator',
    email: user.email ?? null,
    orgName: orgName || 'Your fund',
    orgTier: orgTier || 'Emerging manager',
    level: xpToLevel(xp),
    xp,
    unreadCount,
    memberships,
    activeOrgId,
    avatarUrl
  };
}
