// Engine SLA / stuck-workflow detection (spec section 8 drill-down): a workflow
// that has sat in an active state past the SLA threshold is "stuck" and worth
// flagging. Pure + deterministic — `now` is injected so this is unit-testable
// and renders identically on server and client.
import type { GridWorkflow } from "@/lib/execution-grid";

// Default SLA window: a workflow active longer than this many hours is stuck.
export const DEFAULT_SLA_HOURS = 72;

// Statuses that represent live, unfinished work (mirrors execution-grid).
const ACTIVE_STATUSES = new Set(["awaiting_approval", "in_progress", "pending"]);

const MS_PER_HOUR = 60 * 60 * 1000;

// Hours a workflow has been active, or null if its created_at is unparseable.
function ageHours(createdAt: string, now: Date): number | null {
  const start = Date.parse(createdAt);
  if (Number.isNaN(start)) return null;
  return (now.getTime() - start) / MS_PER_HOUR;
}

/**
 * True when a workflow is in an active status AND has been active longer than
 * the SLA threshold. Null-safe: a bad/missing created_at is never stuck.
 */
export function isStuck(w: GridWorkflow, now: Date, thresholdHours: number = DEFAULT_SLA_HOURS): boolean {
  if (!ACTIVE_STATUSES.has(w.status)) return false;
  const age = ageHours(w.created_at, now);
  if (age === null) return false;
  return age > thresholdHours;
}

// The whole-hours a workflow has been active (floored), or null if unparseable.
// Handy for surfacing "STUCK · {hours}h" in the UI.
export function stuckHours(w: GridWorkflow, now: Date): number | null {
  const age = ageHours(w.created_at, now);
  if (age === null) return null;
  return Math.floor(age);
}

// The subset of workflows that are stuck, preserving input order.
export function stuckWorkflows(
  workflows: GridWorkflow[],
  now: Date,
  thresholdHours: number = DEFAULT_SLA_HOURS,
): GridWorkflow[] {
  return workflows.filter((w) => isStuck(w, now, thresholdHours));
}

// How many workflows are stuck.
export function stuckCount(
  workflows: GridWorkflow[],
  now: Date,
  thresholdHours: number = DEFAULT_SLA_HOURS,
): number {
  return stuckWorkflows(workflows, now, thresholdHours).length;
}
