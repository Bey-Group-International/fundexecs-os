// Per-engine throughput trends for the Execution Grid: how many workflows each
// engine completed in each recent week. Pure + deterministic so it's unit-tested
// and renders identically on server and client. Reuses the same engine
// resolution and canonical ordering as the grid itself.
import { engineOfWorkflow, type GridWorkflow } from "@/lib/execution-grid";
import { TARGET_ENGINES, type TargetEngine } from "@/lib/intelligence";

// Trends need a completion timestamp, which the base grid shape omits. We extend
// it locally rather than touch GridWorkflow (shared with the grid).
export type TrendWorkflow = GridWorkflow & { completed_at: string | null };

const WEEK_MS = 1000 * 60 * 60 * 24 * 7;

export interface TrendPoint {
  // Start of the UTC week (inclusive), as an ISO timestamp.
  weekStart: string;
  // Workflows completed in that week.
  completed: number;
}

export interface EngineTrend {
  engine: TargetEngine;
  // Weekly completed counts, oldest → newest.
  series: TrendPoint[];
}

export interface TrendOptions {
  // Number of weekly buckets ending at (and including) the week of `now`.
  weeks?: number;
  // Reference "now" for the most-recent bucket; injectable for deterministic
  // tests. Defaults to the current time.
  now?: Date | number;
}

// Start of the UTC week (Monday 00:00:00 UTC) containing the given epoch ms.
function weekStartMs(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const daysSinceMonday = (day + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - daysSinceMonday * 24 * 60 * 60 * 1000;
}

// The completion week of a workflow in epoch ms, or null when it can't be
// measured (a missing/unparseable completed_at).
function completedWeekMs(w: TrendWorkflow): number | null {
  if (!w.completed_at) return null;
  const end = Date.parse(w.completed_at);
  if (Number.isNaN(end)) return null;
  return weekStartMs(end);
}

/**
 * Bucket completed workflows by week per engine. Every engine is present (empty
 * series included) and in canonical order; each series has exactly `weeks`
 * points (default 8) ending at the week of `now`, oldest → newest. Workflows
 * completed outside the window are ignored.
 */
export function engineTrends(workflows: TrendWorkflow[], opts: TrendOptions = {}): EngineTrend[] {
  const weeks = opts.weeks ?? 8;
  const nowMs = opts.now === undefined ? Date.now() : opts.now instanceof Date ? opts.now.getTime() : opts.now;
  const latestWeek = weekStartMs(nowMs);
  // Bucket start (ms) for each column, oldest → newest.
  const buckets: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) buckets.push(latestWeek - i * WEEK_MS);
  const indexOf = new Map<number, number>();
  buckets.forEach((ms, i) => indexOf.set(ms, i));

  const counts = new Map<TargetEngine, number[]>();
  for (const e of TARGET_ENGINES) counts.set(e, new Array(weeks).fill(0));

  for (const w of workflows) {
    const week = completedWeekMs(w);
    if (week === null) continue;
    const col = indexOf.get(week);
    if (col === undefined) continue; // outside the window
    counts.get(engineOfWorkflow(w))![col] += 1;
  }

  return TARGET_ENGINES.map<EngineTrend>((engine) => ({
    engine,
    series: buckets.map((ms, i) => ({
      weekStart: new Date(ms).toISOString(),
      completed: counts.get(engine)![i],
    })),
  }));
}
