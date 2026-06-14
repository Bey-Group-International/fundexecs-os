import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getPendingRuns, type PendingRun } from '@/lib/queries/action-queue';

/* ============================================================================
 * lib/queries/chief-of-staff-brief.ts — the operator's morning brief.
 *
 * The Chief-of-Staff brief is the read-only "here's what your desk did and your
 * next decision" surface on the Command Center. It composes existing signals —
 * pending Action-Queue approvals, fresh market-signal matches, the cron-written
 * Earn briefing, and anything overdue — into one glance. Pure read, RLS-scoped,
 * fail-soft to an empty brief; no LLM call (the narration reuses the briefing
 * the intelligence cycle already wrote).
 * ========================================================================= */

export interface ChiefOfStaffBrief {
  /** Run proposals awaiting the operator's approval (the Action Queue). */
  pendingApprovals: PendingRun[];
  pendingApprovalsCount: number;
  /** New, unactioned market-signal matches. */
  newMatchesCount: number;
  /** Open tasks past their due date. */
  overdueCount: number;
  /** The latest Earn briefing from the intelligence cycle, if any. */
  briefing: { body: string; generatedAt: string | null } | null;
}

const EMPTY: ChiefOfStaffBrief = {
  pendingApprovals: [],
  pendingApprovalsCount: 0,
  newMatchesCount: 0,
  overdueCount: 0,
  briefing: null
};

/** Compose the brief for an org. Fail-soft: any read error degrades to empty. */
export async function getChiefOfStaffBrief(orgId: string): Promise<ChiefOfStaffBrief> {
  try {
    const supabase = await createClient();

    const [pending, matchesRes, overdueRes, briefingRes] = await Promise.all([
      getPendingRuns(orgId).catch(() => [] as PendingRun[]),
      // Signal matches use status 'new' (the matches_status_check constraint is
      // new/accepted/dismissed/snoozed — there is no 'pending'); this mirrors
      // how the intelligence cycle writes and reads them.
      supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('kind', 'signal')
        .eq('status', 'new'),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .not('due_at', 'is', null)
        .lt('due_at', new Date().toISOString())
        .not('status', 'in', '(done,failed)'),
      supabase
        .from('intelligence_briefings')
        .select('body, generated_at')
        .eq('org_id', orgId)
        .maybeSingle()
    ]);

    return {
      ...EMPTY,
      pendingApprovals: pending.slice(0, 3),
      pendingApprovalsCount: pending.length,
      newMatchesCount: matchesRes.count ?? 0,
      overdueCount: overdueRes.count ?? 0,
      briefing: briefingRes.data
        ? { body: briefingRes.data.body, generatedAt: briefingRes.data.generated_at }
        : null
    };
  } catch {
    // Any read failure degrades to an empty brief — the surface never throws.
    return EMPTY;
  }
}
