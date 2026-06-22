// Engine-level analytics for the Execution Grid: throughput (counts) and cycle
// time per engine. Pure + deterministic so it's unit-tested and renders
// identically on server and client. Reuses the same engine resolution and
// canonical ordering as the grid itself.
import { engineOfWorkflow, type GridWorkflow } from "@/lib/execution-grid";
import { TARGET_ENGINES, type TargetEngine } from "@/lib/intelligence";

// Cycle time needs a completion timestamp, which the base grid shape omits. We
// extend it locally rather than touch GridWorkflow (shared with the grid).
export type AnalyticsWorkflow = GridWorkflow & { completed_at: string | null };

const ACTIVE_STATUSES = new Set(["awaiting_approval", "in_progress", "pending"]);
const HOUR_MS = 1000 * 60 * 60;

export interface EngineStat {
  engine: TargetEngine;
  total: number;
  active: number; // awaiting approval, in progress, or pending
  completed: number;
  // Mean (completed_at - created_at) in hours over completed workflows that
  // have a completed_at; null when there are none to average.
  avgCycleHours: number | null;
}

export interface AnalyticsRollup {
  total: number;
  active: number;
  completed: number;
  avgCycleHours: number | null;
}

export interface EngineAnalytics {
  engines: EngineStat[];
  rollup: AnalyticsRollup;
}

// Cycle time of a single workflow in hours, or null when it can't be measured
// (not completed, missing/unparseable timestamps, or a negative span).
function cycleHours(w: AnalyticsWorkflow): number | null {
  if (w.status !== "completed" || !w.completed_at) return null;
  const start = Date.parse(w.created_at);
  const end = Date.parse(w.completed_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / HOUR_MS;
}

// Mean of a list of cycle times, null-safe and deterministic; null when empty.
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Per-engine throughput and cycle-time summary plus an org-wide rollup. Every
 * engine is present (zeroed stats included) and in canonical order.
 */
export function engineAnalytics(workflows: AnalyticsWorkflow[]): EngineAnalytics {
  const byEngine = new Map<TargetEngine, AnalyticsWorkflow[]>();
  for (const e of TARGET_ENGINES) byEngine.set(e, []);
  for (const w of workflows) byEngine.get(engineOfWorkflow(w))!.push(w);

  const engines = TARGET_ENGINES.map<EngineStat>((engine) => {
    const list = byEngine.get(engine)!;
    const cycles = list.map(cycleHours).filter((h): h is number => h !== null);
    return {
      engine,
      total: list.length,
      active: list.filter((w) => ACTIVE_STATUSES.has(w.status)).length,
      completed: list.filter((w) => w.status === "completed").length,
      avgCycleHours: mean(cycles),
    };
  });

  const allCycles = workflows.map(cycleHours).filter((h): h is number => h !== null);
  const rollup: AnalyticsRollup = {
    total: engines.reduce((n, s) => n + s.total, 0),
    active: engines.reduce((n, s) => n + s.active, 0),
    completed: engines.reduce((n, s) => n + s.completed, 0),
    avgCycleHours: mean(allCycles),
  };

  return { engines, rollup };
}
