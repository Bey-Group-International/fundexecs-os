import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/dashboard/team-tasks.ts — real per-specialist task workload for
 * the Team-tasks board. Reads org tasks owned by an AI specialist (agent_slug)
 * and rolls them up by slug so the board's motion can be driven by true task
 * status (running / awaiting approval / failed / done) instead of the derived
 * stage state. RLS-scoped; fails soft to an empty map.
 * ========================================================================= */

export type TaskRuntime = 'queued' | 'running' | 'awaiting' | 'blocked' | 'done' | 'failed';

/** Map a free-form `tasks.status` to a canonical runtime state. */
export function normalizeTaskStatus(status: string): TaskRuntime {
  const s = (status || '').toLowerCase();
  if (/(running|in_progress|in progress|executing|active)/.test(s)) return 'running';
  if (/(awaiting|approval|review|needs you|pending_approval)/.test(s)) return 'awaiting';
  if (/(blocked|waiting|stuck)/.test(s)) return 'blocked';
  if (/(done|complete|completed|closed|shipped)/.test(s)) return 'done';
  if (/(failed|error|cancelled|canceled)/.test(s)) return 'failed';
  return 'queued';
}

export interface AgentTaskSummary {
  /** Open work = queued + running + awaiting + blocked. */
  open: number;
  running: number;
  awaiting: number;
  failed: number;
  doneToday: number;
  /** The single most relevant active task to surface on the card. */
  current: { id: string; title: string; status: TaskRuntime } | null;
}

export type TeamTaskMap = Record<string, AgentTaskSummary>;

function empty(): AgentTaskSummary {
  return { open: 0, running: 0, awaiting: 0, failed: 0, doneToday: 0, current: null };
}

export async function getTeamTasks(orgId: string): Promise<TeamTaskMap> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tasks')
    .select('id, agent_slug, title, status, priority, updated_at')
    .eq('org_id', orgId)
    .not('agent_slug', 'is', null)
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error || !data) return {};

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayMs = startOfDay.getTime();

  const map: TeamTaskMap = {};
  for (const row of data) {
    const slug = row.agent_slug;
    if (!slug) continue;
    const s = map[slug] ?? (map[slug] = empty());
    const rt = normalizeTaskStatus(row.status);

    if (rt === 'done') {
      if (Date.parse(row.updated_at) >= dayMs) s.doneToday += 1;
      continue;
    }
    if (rt === 'failed') {
      s.failed += 1;
      continue;
    }
    // open work
    s.open += 1;
    if (rt === 'running') s.running += 1;
    if (rt === 'awaiting') s.awaiting += 1;

    // surface the most relevant active task: running > awaiting > queued/blocked.
    const rank = (x: TaskRuntime) => (x === 'running' ? 3 : x === 'awaiting' ? 2 : 1);
    if (!s.current || rank(rt) > rank(s.current.status)) {
      s.current = { id: row.id, title: row.title, status: rt };
    }
  }

  return map;
}
