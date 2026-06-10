import { createClient } from '@/lib/supabase/server';
import { relativeTime, type AdminActivity } from '@/lib/queries/admin';
import type { Database } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/queries/admin-activity.ts — Paginated admin audit-log loader.
 *
 * `getAdminData` ships only the 10 most recent actions for the portal's
 * first paint. This loader pages the FULL `admin_actions` history behind it:
 * keyset pagination on (created_at, id) — stable under concurrent inserts,
 * no OFFSET scans — with an optional target-type filter so an admin can
 * isolate member, invite, or link/application activity. RLS keeps every read
 * inside the caller's org; errors degrade to an empty page.
 * ========================================================================= */

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type AdminActionRow = Database['public']['Tables']['admin_actions']['Row'];

/** The audit target families the log can be filtered to. These are the
 *  `target_type` values the admin actions actually write: members
 *  (`org_member`), email invites (`beta_invite`), and shareable links plus
 *  their application reviews (`beta_link`). */
export type ActivityTargetType = 'org_member' | 'beta_invite' | 'beta_link';

/** Opaque "older than this row" position in the log. */
export interface ActivityCursor {
  at: string;
  id: string;
}

export interface ActivityPage {
  items: AdminActivity[];
  /** Cursor for the next (older) page; null when the log is exhausted. */
  nextCursor: ActivityCursor | null;
}

export const ACTIVITY_PAGE_SIZE = 20;

/**
 * Fetch one page of the org's admin audit log, newest first, strictly older
 * than `cursor` when given. Fetches limit+1 rows to learn whether another
 * page exists without a separate count query.
 */
export async function getAdminActivity(
  orgId: string,
  opts: {
    cursor?: ActivityCursor;
    targetType?: ActivityTargetType;
    limit?: number;
  } = {}
): Promise<ActivityPage> {
  const limit = Math.min(Math.max(opts.limit ?? ACTIVITY_PAGE_SIZE, 1), 100);
  const supabase = await createClient();

  let query = supabase
    .from('admin_actions')
    .select('id, action_type, target_type, created_at, actor:profiles(full_name)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (opts.targetType) query = query.eq('target_type', opts.targetType);
  if (opts.cursor) {
    // Keyset: rows strictly after the cursor in (created_at desc, id desc)
    // order — id breaks ties when several actions share a timestamp.
    query = query.or(
      `created_at.lt.${opts.cursor.at},and(created_at.eq.${opts.cursor.at},id.lt.${opts.cursor.id})`
    );
  }

  const { data, error } = await query;
  if (error || !data) return { items: [], nextCursor: null };

  type ActionSel = Pick<AdminActionRow, 'id' | 'action_type' | 'target_type' | 'created_at'> & {
    actor: Pick<ProfileRow, 'full_name'> | null;
  };
  const rows = (data as ActionSel[]).slice(0, limit);
  const items: AdminActivity[] = rows.map((a) => ({
    id: a.id,
    actionType: a.action_type,
    targetType: a.target_type,
    actor: a.actor?.full_name ?? 'System',
    time: relativeTime(a.created_at),
    at: a.created_at
  }));

  const last = rows[rows.length - 1];
  return {
    items,
    nextCursor: data.length > limit && last ? { at: last.created_at, id: last.id } : null
  };
}
