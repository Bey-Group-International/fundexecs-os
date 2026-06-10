/**
 * lib/workflows/types.ts — pure types + state machine for Earn workflows.
 *
 * Earn workflows are multi-step sequences executed by AI specialists, gated
 * by accumulated trust-XP. The state machine here is pure (no IO) so both
 * the engine and the unit tests share a single, authoritative transition graph.
 *
 * XP gate: Level 3 = 400 XP (from xpToLevel — floor(sqrt(xp/100)) + 1 = 3
 * implies xp >= 400). The constant WORKFLOW_MIN_LEVEL owns the threshold;
 * the engine's gate converts it to an XP floor via `levelToMinXp`.
 */

import type { Json } from '@/lib/supabase/database.types';

/* --------------------------------------------------------------------------
 * 1. XP / level threshold
 * ------------------------------------------------------------------------ */

/** Earn level required to start a gated workflow (Level 3 = 400 XP). */
export const WORKFLOW_MIN_LEVEL = 3 as const;

/**
 * Minimum accumulated XP that corresponds to `level` under the same curve
 * as `xpToLevel`: level N starts at (N-1)² × 100.
 * Used by the engine to gate on a concrete XP value without re-importing
 * `xpToLevel` in the pure-types module.
 */
export function levelToMinXp(level: number): number {
  return (level - 1) * (level - 1) * 100;
}

/* --------------------------------------------------------------------------
 * 2. Workflow-step statuses + pure state machine
 * ------------------------------------------------------------------------ */

/**
 * Lifecycle states a single workflow step can be in.
 *
 * pending          — not yet reached (step is queued behind earlier steps)
 * active           — currently being executed by the specialist
 * awaiting_approval — specialist is done; waiting for operator sign-off
 * done             — operator approved / step auto-completed successfully
 * skipped          — operator skipped this step (no approval needed)
 * failed           — execution failed; workflow halts here
 */
export type WorkflowStepStatus =
  | 'pending'
  | 'active'
  | 'awaiting_approval'
  | 'done'
  | 'skipped'
  | 'failed';

/** All valid step statuses, for runtime validation. */
export const WORKFLOW_STEP_STATUSES: readonly WorkflowStepStatus[] = [
  'pending',
  'active',
  'awaiting_approval',
  'done',
  'skipped',
  'failed'
] as const;

/**
 * Legal step-status transitions. A step can only move forward (with two
 * exception paths: failed can restart as active, done and skipped are terminal).
 *
 * pending           → active
 * active            → awaiting_approval | done | skipped | failed
 * awaiting_approval → done | skipped | failed
 * done              → (terminal — no outbound transitions)
 * skipped           → (terminal — no outbound transitions)
 * failed            → active  (retry path)
 */
export const STEP_TRANSITIONS: Record<WorkflowStepStatus, readonly WorkflowStepStatus[]> = {
  pending: ['active'],
  active: ['awaiting_approval', 'done', 'skipped', 'failed'],
  awaiting_approval: ['done', 'skipped', 'failed'],
  done: [],
  skipped: [],
  failed: ['active']
};

/**
 * Pure guard: is moving a step from `from` → `to` a legal transition?
 * Used by the engine before writing and by unit tests to verify the graph.
 */
export function canAdvance(from: WorkflowStepStatus, to: WorkflowStepStatus): boolean {
  return (STEP_TRANSITIONS[from] as readonly string[]).includes(to);
}

/* --------------------------------------------------------------------------
 * 3. Workflow-level statuses
 * ------------------------------------------------------------------------ */

/**
 * Lifecycle states for the overall workflow envelope.
 *
 * pending  — created but not yet started (first step not yet activated)
 * running  — at least one step is active / awaiting approval
 * done     — all steps reached a terminal state (done or skipped)
 * failed   — a step failed and has not been retried
 * aborted  — operator explicitly cancelled
 */
export type WorkflowStatus = 'pending' | 'running' | 'done' | 'failed' | 'aborted';

/* --------------------------------------------------------------------------
 * 4. Domain shapes (passed across the engine boundary)
 * ------------------------------------------------------------------------ */

/** Input spec for a single step when starting a workflow. */
export interface WorkflowStepSpec {
  /** Display title shown to the operator. */
  title: string;
  /** Canonical specialist slug from TEAM_ROSTER (validated by the engine). */
  specialistSlug: string;
}

/** Full step record as returned by `getWorkflow`. */
export interface WorkflowStepRecord {
  id: string;
  workflowId: string;
  ordinal: number;
  title: string;
  specialistSlug: string | null;
  status: WorkflowStepStatus;
  result: Json | null;
  createdAt: string;
  updatedAt: string;
}

/** Full workflow record as returned by `getWorkflow`. */
export interface WorkflowRecord {
  id: string;
  orgId: string;
  createdBy: string;
  kind: string;
  status: WorkflowStatus;
  currentStep: number;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStepRecord[];
}
