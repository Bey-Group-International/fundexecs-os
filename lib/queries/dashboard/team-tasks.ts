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

/** A pending run proposal awaiting the operator's approve / reject. */
export interface TaskProposalSummary {
  runId: string;
  action: string;
  steps: string[];
}

export interface AgentTaskSummary {
  /** Open work = queued + running + awaiting + blocked. */
  open: number;
  running: number;
  awaiting: number;
  failed: number;
  doneToday: number;
  /** The single most relevant active task to surface on the card. */
  current: {
    id: string;
    title: string;
    status: TaskRuntime;
    /** Gated run proposal on this task (present when status is 'awaiting'). */
    proposal: TaskProposalSummary | null;
  } | null;
  /** A failed task that can be retried (when there's no active task). */
  retryable: { id: string; title: string } | null;
}

export type TeamTaskMap = Record<string, AgentTaskSummary>;

function empty(): AgentTaskSummary {
  return {
    open: 0,
    running: 0,
    awaiting: 0,
    failed: 0,
    doneToday: 0,
    current: null,
    retryable: null
  };
}

export async function getTeamTasks(orgId: string): Promise<TeamTaskMap> {
  const supabase = await createClient();

  // Full set (no sampling) so per-agent totals stay exact; only the small
  // columns are selected. A SQL GROUP BY rollup is the scale follow-up.
  const { data, error } = await supabase
    .from('tasks')
    .select('id, agent_slug, title, status, priority, updated_at')
    .eq('org_id', orgId)
    .not('agent_slug', 'is', null)
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error || !data) return {};

  // UTC day boundary so `doneToday` doesn't drift with the server timezone.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
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
      if (!s.retryable) s.retryable = { id: row.id, title: row.title };
      continue;
    }
    // open work
    s.open += 1;
    if (rt === 'running') s.running += 1;
    if (rt === 'awaiting') s.awaiting += 1;

    // surface the most relevant active task: running > awaiting > queued/blocked.
    const rank = (x: TaskRuntime) => (x === 'running' ? 3 : x === 'awaiting' ? 2 : 1);
    if (!s.current || rank(rt) > rank(s.current.status)) {
      s.current = { id: row.id, title: row.title, status: rt, proposal: null };
    }
  }

  // Attach pending run proposals to whichever surfaced task they belong to, so
  // an 'awaiting' card can render its confirm card. Cheap second read scoped to
  // open proposals only.
  const { data: runs } = await supabase
    .from('task_runs')
    .select('id, task_id, action, steps')
    .eq('org_id', orgId)
    .eq('status', 'proposed');

  if (runs && runs.length > 0) {
    const byTask = new Map(runs.map((r) => [r.task_id, r] as const));
    for (const s of Object.values(map)) {
      if (!s.current) continue;
      const run = byTask.get(s.current.id);
      if (!run) continue;
      const steps = Array.isArray(run.steps) ? (run.steps as unknown[]).map(String) : [];
      s.current.proposal = { runId: run.id, action: run.action, steps };
    }
  }

  return map;
}
