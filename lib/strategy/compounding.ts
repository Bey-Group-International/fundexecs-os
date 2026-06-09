/* ============================================================================
 * lib/strategy/compounding.ts — the dynamic/compounding objective engine (pure).
 *
 * Phase 2b of memory/STRATEGY_COMPOUNDING_BLUEPRINT.md, the migration-dependent
 * half. Everything here is pure, deterministic, and unit-tested like
 * lib/lifecycle.ts — no Supabase I/O. The query/action layers gather the inputs
 * (objective rows, lifecycle gate state, trust layers) and call these helpers,
 * so the same derivation can be reasoned about in tests and reused across the
 * read (real `pct`, draft state) and write (cascade, gate-unlock) paths.
 *
 * Three jobs:
 *  1. Real progress — derive an objective's completion `pct` from lifecycle gate
 *     progress and the linked Chain-of-Trust layer, retiring the faked
 *     status→{0,50,100} mapping.
 *  2. Cascade — closing a 100-day bet spawns its 30-day children; a 30 spawns
 *     10-day moves. We compute the child *specs* here; the action layer inserts.
 *  3. Gate-unlock — given the lifecycle gate state before and after a completion,
 *     detect a gate that flipped cleared and surface the stage it unlocks.
 * ========================================================================= */

import {
  LIFECYCLE_STAGES,
  LIFECYCLE_STAGE_LABELS,
  LIFECYCLE_STAGE_BLURBS,
  type LifecycleStage
} from '@/lib/lifecycle';

/* ----------------------------------------------------------------------------
 * Shared shapes
 * ------------------------------------------------------------------------- */

export type ObjectiveTier = '100' | '30' | '10';
export type ObjectiveState = 'open' | 'done' | 'archived';

/** Whether an objective came from an Earn/specialist draft vs. manual entry. */
export type ObjectiveSource = 'manual' | 'signal' | 'lifecycle' | 'cascade';

/* ----------------------------------------------------------------------------
 * 1. Real progress derivation
 *
 * The legacy `statusPct` faked 0/50/100 from the status string. The real signal
 * is: a done objective is 100; otherwise its progress is the lifecycle loop's
 * progress toward clearing the objective's `lifecycle_stage` gate, blended with
 * the linked Chain-of-Trust layer for its posture category. This keeps the
 * number honest (it moves when the substrate moves) and degrades gracefully —
 * when no lifecycle stage / category is set, it falls back to the same coarse
 * status mapping so pre-migration rows are unchanged.
 * ------------------------------------------------------------------------- */

/** Inputs for deriving a single objective's real completion percentage. */
export interface ObjectiveProgressInput {
  /** Normalized objective state. */
  state: ObjectiveState;
  /** Raw status string (for the legacy fallback). */
  status: string;
  /** Posture lane, when categorized. Drives the trust-layer blend. */
  category?: string | null;
  /** Lifecycle stage this objective advances, when set. */
  lifecycleStage?: string | null;
  /**
   * Per-stage gate-cleared map from `computeLifecycleStageResult`. When the
   * objective's stage gate is cleared the objective is effectively delivered by
   * the substrate even if its status lags.
   */
  gatesCleared?: Partial<Record<LifecycleStage, boolean>> | null;
  /** Overall loop progress 0–100 (cleared gates / total), as a soft floor. */
  loopProgress?: number | null;
  /** Chain-of-Trust layer completion, 0–100 each. */
  trust?: { truth: number; concept: number; execution: number; work: number } | null;
}

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

function isLifecycleStage(s: string): s is LifecycleStage {
  return (LIFECYCLE_STAGES as readonly string[]).includes(s);
}

/** The trust layer that best evidences each posture category. */
function trustLayerForCategory(
  category: string | null | undefined,
  trust: { truth: number; concept: number; execution: number; work: number }
): number | null {
  switch ((category ?? '').toLowerCase()) {
    case 'compliance':
      return trust.truth;
    case 'governance':
      return trust.concept;
    case 'execution':
      return trust.execution;
    case 'capital':
      // Capital progress isn't a trust layer; let the lifecycle signal carry it.
      return null;
    default:
      return null;
  }
}

/** Coarse legacy status → pct, preserved for ungrounded rows. */
function legacyStatusPct(state: ObjectiveState, status: string): number {
  if (state === 'done') return 100;
  const s = status.toLowerCase();
  if (s === 'in_progress' || s === 'in-progress' || s === 'active') return 50;
  return 0;
}

/**
 * Derive a real 0–100 completion percentage for an objective. A done objective
 * is always 100. Otherwise we blend two real signals:
 *  - lifecycle: if the objective's stage gate is cleared → 100; else the loop
 *    progress toward it acts as a soft floor.
 *  - trust: the Chain-of-Trust layer that evidences the objective's category.
 * When neither signal is available we fall back to the legacy status mapping, so
 * uncategorized / unstaged rows behave exactly as before (no regression).
 */
export function deriveObjectivePct(input: ObjectiveProgressInput): number {
  if (input.state === 'done') return 100;
  if (input.state === 'archived') return legacyStatusPct(input.state, input.status);

  const signals: number[] = [];

  const stage = input.lifecycleStage ?? null;
  if (stage && isLifecycleStage(stage)) {
    const cleared = input.gatesCleared?.[stage] ?? false;
    if (cleared) {
      // The substrate already satisfies this objective's gate — it's delivered.
      signals.push(100);
    } else if (input.loopProgress != null) {
      signals.push(clamp100(input.loopProgress));
    }
  }

  if (input.trust) {
    const layer = trustLayerForCategory(input.category, input.trust);
    if (layer != null) signals.push(clamp100(layer));
  }

  if (signals.length === 0) return legacyStatusPct(input.state, input.status);

  // Mean of the available real signals, floored by the legacy status hint so an
  // explicitly in-progress objective never reads below 50 once it has a signal.
  const mean = signals.reduce((s, n) => s + n, 0) / signals.length;
  const status = input.status.toLowerCase();
  const floor = status.includes('progress') || status === 'active' ? 50 : 0;
  return clamp100(Math.max(mean, floor));
}

/* ----------------------------------------------------------------------------
 * Draft state
 *
 * A specialist/signal draft is one that has not been approved into the live plan
 * yet (`approved_at` is null) and did not come from the manual create path. The
 * "Earn drafts, you approve" decision: drafts are visible but visually distinct
 * and require a one-click approval before they count.
 * ------------------------------------------------------------------------- */

export interface DraftStateInput {
  approvedAt: string | null;
  source: string;
}

/**
 * True when an objective is a pending draft awaiting operator approval. Manual
 * objectives are never drafts (the create path stamps approval); a missing
 * `approved_at` on a non-manual objective means "drafted, not yet approved".
 */
export function isPendingDraft(input: DraftStateInput): boolean {
  if (input.approvedAt != null) return false;
  return (input.source ?? 'manual').toLowerCase() !== 'manual';
}

/* ----------------------------------------------------------------------------
 * 2. Cascade — completing a tier spawns the next tier's children
 *
 * Closing a 100-day bet spawns its 30-day milestones; closing a 30-day spawns
 * 10-day moves. A 10-day move is a leaf (no cascade). We compute the child
 * *specs* purely here; the action layer turns them into inserts with the parent
 * id, org, and plan attached. Cascaded children are themselves drafts (source
 * 'cascade', unapproved) so the operator still confirms them — control retained.
 * ------------------------------------------------------------------------- */

/** The next tier down a 100→30→10 cascade, or null for a leaf (10-day). */
export function childTier(tier: ObjectiveTier): ObjectiveTier | null {
  if (tier === '100') return '30';
  if (tier === '30') return '10';
  return null;
}

const TIER_TIMELINE: Record<ObjectiveTier, string> = {
  '100': '100 days',
  '30': '30 days',
  '10': '10 days'
};

/** A child objective the cascade proposes when a parent is completed. */
export interface CascadeChildSpec {
  objective: string;
  timeline: string;
  tier: ObjectiveTier;
  /** Carried from the parent so the lane/scoring stays coherent. */
  category: string | null;
  lifecycleStage: string | null;
}

export interface CascadeParentInput {
  tier: ObjectiveTier;
  title: string;
  category?: string | null;
  lifecycleStage?: string | null;
}

/**
 * Compute the child objective specs spawned when `parent` is completed. Returns
 * a single next-tier follow-through child (the cascade is deliberately
 * conservative — one concrete next move, not a fan-out the operator must prune).
 * A 10-day move returns `[]` (leaf). The child inherits the parent's category and
 * lifecycle stage so posture scoring and gate alignment stay coherent.
 */
export function computeCascadeChildren(parent: CascadeParentInput): CascadeChildSpec[] {
  const tier = childTier(parent.tier);
  if (tier === null) return [];
  const verb = tier === '30' ? 'Advance' : 'Execute';
  return [
    {
      objective: `${verb}: ${parent.title}`,
      timeline: TIER_TIMELINE[tier],
      tier,
      category: parent.category ?? null,
      lifecycleStage: parent.lifecycleStage ?? null
    }
  ];
}

/* ----------------------------------------------------------------------------
 * 3. Gate-unlock detection
 *
 * On objective completion the action layer re-runs the lifecycle engine. If a
 * forward gate that was NOT cleared before is cleared after, the manager has
 * unlocked the next stage — surface it ("Proof of Concept complete → LP outreach
 * unlocks"). Pure diff over two gate-cleared maps.
 * ------------------------------------------------------------------------- */

export interface GateUnlock {
  /** The stage whose forward gate just cleared. */
  clearedStage: LifecycleStage;
  /** The stage that clearing it unlocks (the next in the loop), if any. */
  unlockedStage: LifecycleStage | null;
  /** Human label + blurb for the unlocked stage (UI copy). */
  unlockedLabel: string | null;
  unlockedBlurb: string | null;
  /** Ready-to-show celebration line. */
  message: string;
}

/**
 * Detect the gate that flipped from not-cleared to cleared between two snapshots
 * of the lifecycle gate state. Returns the first such gate in loop order (the
 * earliest newly-cleared gate is the meaningful unlock), or null when nothing
 * changed. The action layer captures `before` prior to the completing write and
 * `after` from a fresh `computeLifecycleStageResult`.
 */
export function detectGateUnlock(
  before: Partial<Record<LifecycleStage, boolean>>,
  after: Partial<Record<LifecycleStage, boolean>>
): GateUnlock | null {
  for (let i = 0; i < LIFECYCLE_STAGES.length; i++) {
    const stage = LIFECYCLE_STAGES[i];
    const wasCleared = before[stage] ?? false;
    const nowCleared = after[stage] ?? false;
    if (!wasCleared && nowCleared) {
      const unlockedStage = LIFECYCLE_STAGES[i + 1] ?? null;
      const unlockedLabel = unlockedStage ? LIFECYCLE_STAGE_LABELS[unlockedStage] : null;
      const unlockedBlurb = unlockedStage ? LIFECYCLE_STAGE_BLURBS[unlockedStage] : null;
      const clearedLabel = LIFECYCLE_STAGE_LABELS[stage];
      const message = unlockedLabel
        ? `${clearedLabel} complete → ${unlockedLabel} unlocks.`
        : `${clearedLabel} complete — you've reached the end of the loop.`;
      return { clearedStage: stage, unlockedStage, unlockedLabel, unlockedBlurb, message };
    }
  }
  return null;
}
