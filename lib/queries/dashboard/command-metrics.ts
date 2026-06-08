import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/dashboard/command-metrics.ts — the four "command boxes" counts.
 *
 * Real, RLS-scoped counts for the Command Center metric row:
 *   • activeCommitments  — capital_commitments still live in the pipeline
 *   • underReview        — diligence_runs currently in/awaiting review
 *   • tasksDueThisWeek   — open tasks due within the next 7 days (incl. overdue)
 * Each count fails soft to 0 so a single query hiccup never blanks the row.
 * ========================================================================= */

export interface CommandMetrics {
  activeCommitments: number;
  underReview: number;
  tasksDueThisWeek: number;
}

type CountQuery = PromiseLike<{ count: number | null; error: unknown }>;

async function safeCount(q: CountQuery): Promise<number> {
  try {
    const { count, error } = await q;
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

export async function getCommandMetrics(orgId: string): Promise<CommandMetrics> {
  const supabase = await createClient();
  const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [activeCommitments, underReview, tasksDueThisWeek] = await Promise.all([
    safeCount(
      supabase
        .from('capital_commitments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .not('stage', 'in', '(passed,lost,dead,declined,withdrawn,closed_lost,cancelled)')
    ),
    safeCount(
      supabase
        .from('diligence_runs')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .in('status', [
          'in_progress',
          'running',
          'review',
          'in_review',
          'pending',
          'analyzing',
          'queued'
        ])
    ),
    safeCount(
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .lte('due_at', weekEnd)
        .not('status', 'in', '(done,completed,complete,cancelled,canceled,archived)')
    )
  ]);

  return { activeCommitments, underReview, tasksDueThisWeek };
}
