// Builds the Command Center's live activity overlay: which executive is working
// on what, right now, from the org's real tasks. The world engine seeds each
// matching avatar at its station with this task label, so the "Earn Command"
// floor reflects actual in-progress work on load instead of an idle demo.
//
// Pure + deterministic so it can be unit-tested without a DB; the route feeds it
// pre-filtered, recency-ordered task rows.

/** The active statuses that count as "an executive is working on this". */
export const ACTIVE_TASK_STATUSES = ["pending", "in_progress", "awaiting_approval"] as const;
const ACTIVE_SET = new Set<string>(ACTIVE_TASK_STATUSES);

export interface ActivityInfo {
  /** Task label shown at the executive's station. */
  task: string;
  /** 0..1 progress for the working ring. */
  progress: number;
}

/** agentKey -> current activity. */
export type ActivityMap = Record<string, ActivityInfo>;

interface TaskRow {
  assigned_agent: string | null;
  title: string | null;
  status: string | null;
  progress: number | null;
}

// Normalize a raw task progress (0..100 or 0..1) into 0..1.
function normalizeProgress(raw: number | null): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  const v = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, v));
}

/**
 * Reduce active task rows to one activity per executive. The caller pre-orders
 * rows by recency, so the FIRST active task seen for an agent wins (their most
 * recent). Non-active statuses and rows without an agent/title are skipped.
 */
export function buildActivityMap(tasks: TaskRow[]): ActivityMap {
  const map: ActivityMap = {};
  for (const t of tasks) {
    if (!t.assigned_agent || !t.title) continue;
    if (t.status && !ACTIVE_SET.has(t.status)) continue;
    if (map[t.assigned_agent]) continue; // keep the first (most recent) per agent
    map[t.assigned_agent] = { task: t.title, progress: normalizeProgress(t.progress) };
  }
  return map;
}
