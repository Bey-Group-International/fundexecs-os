import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/lib/access.server';

export interface AccessAuditEntry {
  /** ISO timestamp the decision was recorded. */
  at: string;
  /** 'approved' | 'rejected' | 'pending' — the decision that was applied. */
  decision: string;
  /** Email of the admin who made the decision, if resolvable. */
  actorEmail: string | null;
  /** The applicant's auth user id the decision targeted. */
  targetUserId: string | null;
  /** The applicant's email, if resolvable. */
  targetEmail: string | null;
}

/** Map an `access_<decision>` action_type back to the bare decision. */
function decisionOf(actionType: string): string {
  return actionType.startsWith('access_') ? actionType.slice('access_'.length) : actionType;
}

/**
 * The beta access decision history — every approve / decline / reset written by
 * `setMemberAccess`, newest first, enriched with the acting admin's email and
 * the applicant's email. Platform-admin (Bey Group) only; reads with the
 * service-role client (the log spans orgs and resolves auth emails) after the
 * gate, and degrades to an empty list on any failure.
 *
 * Bounded to the access-decision action types so the export is the access audit
 * trail specifically, not the whole `admin_actions` log (role changes, invites,
 * etc.), which the in-app Activity panel already pages per-org.
 */
export async function getAccessAuditLog(limit = 5000): Promise<AccessAuditEntry[]> {
  if (!(await requirePlatformAdmin())) return [];

  const admin = createAdminClient();
  const { data: actions, error } = await admin
    .from('admin_actions')
    .select('action_type, admin_user_id, target_id, created_at')
    .in('action_type', ['access_approved', 'access_rejected', 'access_pending'])
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 10000));
  if (error || !actions || actions.length === 0) return [];

  // Resolve actor + target emails from the auth schema in one pass. Capped at
  // beta scale; degrade to null emails (ids still export) if the page overflows.
  const usersResult = await admin.auth.admin
    .listUsers({ page: 1, perPage: 1000 })
    .catch(() => null);
  const emailById = new Map((usersResult?.data?.users ?? []).map((u) => [u.id, u.email ?? null]));

  return actions.map((a) => ({
    at: a.created_at,
    decision: decisionOf(a.action_type),
    actorEmail: a.admin_user_id ? (emailById.get(a.admin_user_id) ?? null) : null,
    targetUserId: a.target_id,
    targetEmail: a.target_id ? (emailById.get(a.target_id) ?? null) : null
  }));
}
