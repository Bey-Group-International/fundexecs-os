import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/lib/access.server';
import { isMemberType, type MemberType } from '@/lib/member-types';

export type AccessStatus = 'pending' | 'approved' | 'rejected';

export interface AccessApplicant {
  /** The applicant's auth user id — the key access decisions are written against. */
  userId: string;
  email: string | null;
  /** Display name from the profile, falling back to the captured brief name. */
  name: string | null;
  /** The company they set up at onboarding (the org they own), if any. */
  company: string | null;
  memberType: MemberType | null;
  /** One-line mandate summary (role · objective) reconstructed from the brief. */
  mandate: string | null;
  /** Their own one-line goal, if they gave one. */
  goal: string | null;
  /** Whether they finished the brief (onboarding `status === 'complete'`). */
  onboardingComplete: boolean;
  access: AccessStatus;
  decidedAt: string | null;
  createdAt: string;
}

function normalizeAccess(value: unknown): AccessStatus {
  return value === 'approved' || value === 'rejected' ? value : 'pending';
}

function jsonString(blob: unknown, key: string): string | null {
  if (!blob || typeof blob !== 'object') return null;
  const value = (blob as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Reconstruct a short "role · objective" line from the captured mandate blob. */
function mandateSummary(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const mandate = (details as Record<string, unknown>).mandate;
  if (!mandate || typeof mandate !== 'object') return null;
  const m = mandate as Record<string, unknown>;
  const parts = [m.investorRole, m.objective].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The platform-wide Applications inbox: every signed-up member and their beta
 * access decision (`member_profiles.access_status`), enriched with the brief
 * they gave Earn (name, member type, mandate, goal) and the company they set up
 * at onboarding. Pending first (the worklist), then approved, then rejected;
 * newest within each group.
 *
 * Reads with the service-role client because it spans every user and reads
 * `member_profiles.draft`/`details` (not cross-member readable under RLS) plus
 * auth emails — so it self-gates on platform admin first and returns an empty
 * list for anyone else. Degrades to an empty list on any failure so the portal
 * still renders.
 */
export async function getAccessApplicants(): Promise<AccessApplicant[]> {
  if (!(await requirePlatformAdmin())) return [];

  const admin = createAdminClient();

  const { data: profiles, error } = await admin
    .from('member_profiles')
    .select(
      'user_id, display_name, draft, details, status, access_status, access_decided_at, created_at'
    )
    .order('updated_at', { ascending: false });
  if (error || !profiles || profiles.length === 0) return [];

  const userIds = [...new Set(profiles.map((p) => p.user_id))];

  const [{ data: people }, { data: memberships }, usersResult] = await Promise.all([
    admin.from('profiles').select('id, full_name, member_type').in('id', userIds),
    admin
      .from('org_members')
      .select('user_id, org_id, role, created_at')
      .in('user_id', userIds)
      .order('created_at', { ascending: true }),
    // Auth emails aren't in `profiles`; resolve them from the auth schema. A cap
    // is fine for beta scale — degrade to null emails if the page overflows.
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }).catch(() => null)
  ]);

  const personById = new Map((people ?? []).map((p) => [p.id, p]));
  const emailById = new Map((usersResult?.data?.users ?? []).map((u) => [u.id, u.email ?? null]));

  // Resolve each applicant's own company: the earliest org they own, else the
  // earliest org of any role. Rows are oldest-first so the first match wins.
  const orgByUser = new Map<string, { orgId: string; role: string | null }>();
  for (const m of memberships ?? []) {
    const existing = orgByUser.get(m.user_id);
    if (!existing) {
      orgByUser.set(m.user_id, { orgId: m.org_id, role: m.role });
    } else if (m.role === 'owner' && existing.role !== 'owner') {
      orgByUser.set(m.user_id, { orgId: m.org_id, role: m.role });
    }
  }
  const orgIds = [...new Set([...orgByUser.values()].map((v) => v.orgId))];
  const { data: orgs } = orgIds.length
    ? await admin.from('organizations').select('id, name').in('id', orgIds)
    : { data: [] };
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  const enriched: AccessApplicant[] = profiles.map((p) => {
    const person = personById.get(p.user_id);
    const org = orgByUser.get(p.user_id);
    return {
      userId: p.user_id,
      email: emailById.get(p.user_id) ?? null,
      name: person?.full_name?.trim() || p.display_name?.trim() || jsonString(p.draft, 'name'),
      company: org ? orgNameById.get(org.orgId)?.trim() || null : null,
      memberType: isMemberType(person?.member_type) ? person.member_type : null,
      mandate: mandateSummary(p.details),
      goal: jsonString(p.draft, 'goal'),
      onboardingComplete: p.status === 'complete',
      access: normalizeAccess(p.access_status),
      decidedAt: p.access_decided_at,
      createdAt: p.created_at
    };
  });

  const rank: Record<AccessStatus, number> = { pending: 0, approved: 1, rejected: 2 };
  return enriched.sort((a, b) => rank[a.access] - rank[b.access]);
}
