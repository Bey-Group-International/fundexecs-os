import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type TaskRow = Database['public']['Tables']['tasks']['Row'];

export interface EarnTask {
  id: string;
  title: string;
  desc: string;
  source: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  due: string;
  state: 'open' | 'done' | 'archived';
  read: boolean;
  /** Earn's suggested next move for this task, surfaced as a gold note row. */
  earnNote: string;
}

/** Format a due timestamp as a short date, or "—" when unset. */
function formatDue(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Map a task status to the board state used by the task manager UI. */
function normalizeState(status: string): EarnTask['state'] {
  const s = status.toLowerCase();
  if (s === 'done' || s === 'complete' || s === 'completed' || s === 'closed') return 'done';
  if (s === 'archived' || s === 'cancelled' || s === 'canceled') return 'archived';
  return 'open';
}

/**
 * Map an optional stored priority to the task manager's tone scale.
 * Tasks have no priority column, so this is inferred from the `source`
 * convention (`critical:*` / `high:*`) and otherwise defaults to Medium.
 */
function derivePriority(source: string): EarnTask['priority'] {
  const s = source.toLowerCase();
  if (s.includes('critical')) return 'Critical';
  if (s.includes('high')) return 'High';
  if (s.includes('low')) return 'Low';
  return 'Medium';
}

/**
 * Build Earn's suggested next move for a task. Earn drafts a concrete action
 * per task from its title/priority so the UI always has a "Earn note" to show,
 * mirroring the live recommendations Earn surfaces without a round-trip.
 */
function deriveEarnNote(title: string, priority: EarnTask['priority']): string {
  const t = title.toLowerCase();
  if (t.includes('follow up') || t.includes('reactivat'))
    return 'Send the drafted note; propose a 20-min call this week.';
  if (t.includes('proof of concept') || t.includes('roll-up'))
    return 'Concept layer is 0% — start with the market memo.';
  if (t.includes('financ') || t.includes('ttm') || t.includes('diligence'))
    return 'Draft seller outreach requesting trailing-twelve-month P&L.';
  if (t.includes('lp') || t.includes('investor'))
    return 'Generate a targeted LP shortlist matched to this mandate.';
  if (t.includes('deck') || t.includes('memo'))
    return 'Review the deck like an institutional LP and flag gaps.';
  if (priority === 'Critical' || priority === 'High')
    return 'High priority — Earn can draft the first move now.';
  return 'Ask Earn to draft the next step for this task.';
}

/**
 * Fetch the org's tasks for the Ask Earn task manager. RLS-scoped via the
 * server client; query errors degrade to an empty list so the page never
 * throws at render time.
 */
export async function getEarnTasks(orgId: string): Promise<EarnTask[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, description, due_at, source, status')
    .eq('org_id', orgId)
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data) return [];

  return (
    data as Pick<TaskRow, 'id' | 'title' | 'description' | 'due_at' | 'source' | 'status'>[]
  ).map((t) => {
    const priority = derivePriority(t.source);
    return {
      id: t.id,
      title: t.title,
      desc: t.description ?? '',
      source: t.source,
      priority,
      due: formatDue(t.due_at),
      state: normalizeState(t.status),
      read: true,
      earnNote: deriveEarnNote(t.title, priority)
    };
  });
}
