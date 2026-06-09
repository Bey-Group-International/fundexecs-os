/**
 * lib/readiness.ts — the compound-readiness engine.
 *
 * `lib/lifecycle.ts` answers "how investable am I right now?" with a flat
 * weighted average of five dimensions. That number is honest but static: it
 * treats a manager with strong proof and a thin pipeline the same as one with
 * weak proof and a fat pipeline, as long as the weighted points tie. In
 * reality the dimensions *reinforce* each other — a deep LP pipeline that sits
 * on no verifiable trust is worth less than its raw size suggests, and a
 * complete, balanced system compounds into something an LP rewards beyond the
 * sum of its parts.
 *
 * This module layers that intuition on top of the base breakdown, as PURE
 * functions so both the server loader and the client what-if panel can call
 * them. It never re-reads Supabase — it takes the already-computed
 * `ReadinessDimensionScore[]` and the raise target as inputs.
 *
 * The model, in one breath:
 *   1. Foundation (Profile + Proof) sets a `synergy` factor 0.7→1.0.
 *   2. Execution dimensions (Materials, Pipeline, Capital) are scaled by that
 *      synergy — outreach without trust is discounted, never inflated.
 *   3. A `balanceBonus` rewards a *closed loop*: once every dimension clears a
 *      floor, the system compounds for up to +8 points scaled by the weakest
 *      link. This is the "compounding loop" made literal.
 *   4. The compound score drives a projected $ outcome, and each dimension's
 *      gap is priced in dollars-unlocked-per-point so actions can be ranked by
 *      value, not just by size of gap.
 */

import {
  READINESS_WEIGHTS,
  type ReadinessDimension,
  type ReadinessDimensionScore
} from './lifecycle';

/* ============================================================================
 * Tunables — all documented, all exported so the UI and tests reference the
 * exact numbers rather than hard-coding them.
 * ========================================================================= */

/** Which dimensions set the foundation vs. which are downstream execution. */
export const FOUNDATION_DIMENSIONS: readonly ReadinessDimension[] = ['profile', 'proof'] as const;
export const EXECUTION_DIMENSIONS: readonly ReadinessDimension[] = [
  'materials',
  'pipeline',
  'capital'
] as const;

/** Synergy floor: execution counts at 70% when the foundation is empty. */
const SYNERGY_FLOOR = 0.7;
/** The remaining 30% is earned back as the foundation approaches 100. */
const SYNERGY_RANGE = 1 - SYNERGY_FLOOR;

/** The weakest dimension must clear this floor before the loop compounds. */
export const BALANCE_FLOOR = 40;
/** Maximum points a perfectly balanced, complete system earns on top. */
export const MAX_BALANCE_BONUS = 8;

/**
 * The compound score an LP broadly treats as "institutional-ready". Aligns with
 * the Command Center alert threshold so every surface draws the same line. Used
 * as the benchmark reference on the gauge and trajectory.
 */
export const INSTITUTIONAL_BAR = 70;

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));
const isFoundation = (d: ReadinessDimension): boolean => FOUNDATION_DIMENSIONS.includes(d);

/* ============================================================================
 * Compound score
 * ========================================================================= */

/** One dimension's role in the compounded result. */
export interface CompoundDimension {
  dimension: ReadinessDimension;
  /** 0–100 raw score (unchanged from the base breakdown). */
  score: number;
  /** Weight in the overall score. */
  weight: number;
  /** 'foundation' dimensions drive synergy; 'execution' dimensions are scaled by it. */
  kind: 'foundation' | 'execution';
  /** Weighted points after synergy scaling (the compounded contribution). */
  contribution: number;
  /**
   * Points the compound score gains if this single dimension is taken to 100,
   * holding the others fixed. The marginal value of closing this gap.
   */
  lift: number;
}

export interface CompoundReadiness {
  /** The flat weighted-average score (matches `computeReadinessScore`). */
  baseScore: number;
  /** The reinforced score after synergy + balance bonus. */
  compoundScore: number;
  /** compoundScore / baseScore — >1 means the system reinforces, <1 drags. */
  multiplier: number;
  /** 0–1 strength of the Profile+Proof foundation. */
  foundationStrength: number;
  /** The 0.7–1.0 factor execution dimensions are scaled by. */
  synergy: number;
  /** Extra points earned for a balanced, closed loop (0–MAX_BALANCE_BONUS). */
  balanceBonus: number;
  /** The weakest dimension — the link gating the loop. */
  weakestLink: ReadinessDimension;
  /** Per-dimension detail in display order. */
  dimensions: CompoundDimension[];
}

/** Weighted average of the foundation dimensions, normalized to 0–1. */
function foundationStrengthOf(byDim: Record<ReadinessDimension, number>): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const d of FOUNDATION_DIMENSIONS) {
    weighted += byDim[d] * READINESS_WEIGHTS[d];
    totalWeight += READINESS_WEIGHTS[d];
  }
  return totalWeight > 0 ? weighted / totalWeight / 100 : 0;
}

/**
 * Core scoring kernel. Given the five raw 0–100 scores, return the compound
 * score and its parts. Pure and cheap, so the what-if panel can call it on
 * every slider tick.
 */
function scoreFrom(byDim: Record<ReadinessDimension, number>): {
  compoundScore: number;
  synergy: number;
  foundationStrength: number;
  balanceBonus: number;
} {
  const foundationStrength = foundationStrengthOf(byDim);
  const synergy = SYNERGY_FLOOR + SYNERGY_RANGE * foundationStrength;

  let weighted = 0;
  for (const dim of Object.keys(byDim) as ReadinessDimension[]) {
    const factor = isFoundation(dim) ? 1 : synergy;
    weighted += (byDim[dim] * factor * READINESS_WEIGHTS[dim]) / 100;
  }

  // The loop only compounds once every link exists. Scale the bonus by how far
  // the weakest dimension clears the floor, so closing the last gap is what
  // actually unlocks the upside.
  const weakest = Math.min(...Object.values(byDim));
  const balanceBonus =
    weakest > BALANCE_FLOOR
      ? ((weakest - BALANCE_FLOOR) / (100 - BALANCE_FLOOR)) * MAX_BALANCE_BONUS
      : 0;

  return {
    compoundScore: clamp100(weighted + balanceBonus),
    synergy,
    foundationStrength,
    balanceBonus
  };
}

/**
 * Compute the compound readiness from the base per-dimension breakdown. The
 * `baseScore` it reports equals `computeReadinessScore().score`, so the two
 * engines never disagree on the flat number — the compound score is layered
 * strictly on top.
 */
export function computeCompoundReadiness(breakdown: ReadinessDimensionScore[]): CompoundReadiness {
  const byDim = Object.fromEntries(
    breakdown.map((d) => [d.dimension, clamp100(d.score)])
  ) as Record<ReadinessDimension, number>;

  const base = breakdown.reduce((sum, d) => sum + (d.score * d.weight) / 100, 0);
  const { compoundScore, synergy, foundationStrength, balanceBonus } = scoreFrom(byDim);

  const dimensions: CompoundDimension[] = breakdown.map((d) => {
    const kind = isFoundation(d.dimension) ? 'foundation' : 'execution';
    const factor = kind === 'foundation' ? 1 : synergy;
    const contribution = (d.score * factor * d.weight) / 100;
    // Marginal lift: recompute the whole score with this one dimension maxed.
    const lifted = scoreFrom({ ...byDim, [d.dimension]: 100 }).compoundScore;
    const lift = Math.max(0, lifted - compoundScore);
    return { dimension: d.dimension, score: d.score, weight: d.weight, kind, contribution, lift };
  });

  const weakestLink = breakdown.reduce((min, d) => (d.score < min.score ? d : min)).dimension;
  const baseScore = Math.round(base);
  const rounded = Math.round(compoundScore);

  return {
    baseScore,
    compoundScore: rounded,
    multiplier: baseScore > 0 ? rounded / baseScore : 1,
    foundationStrength,
    synergy,
    balanceBonus,
    weakestLink,
    dimensions
  };
}

/* ============================================================================
 * Value translation — "multiply value"
 * ========================================================================= */

export interface ReadinessValue {
  /** The raise target the projection is anchored to (0 when unset). */
  target: number;
  /** Projected capital closeable at the current compound readiness. */
  projected: number;
  /** Capital still locked behind the readiness gap (target − projected). */
  locked: number;
  /** Per-dimension dollar value unlocked by taking that dimension to 100. */
  unlockByDimension: Record<ReadinessDimension, number>;
}

/**
 * Translate a compound score into projected capital. Linear in the score:
 * `target × score/100`. When no target is set the projection is 0 but the
 * compound score still stands on its own.
 */
export function projectValue(target: number, compoundScore: number): number {
  if (!(target > 0)) return 0;
  return Math.round((target * clamp100(compoundScore)) / 100);
}

/**
 * Price each dimension's gap in dollars. A dimension's unlock is the projected
 * value it adds when its gap closes — i.e. its compound `lift` translated
 * through the target. This is what lets actions rank by value, not gap size.
 */
export function computeReadinessValue(compound: CompoundReadiness, target: number): ReadinessValue {
  const projected = projectValue(target, compound.compoundScore);
  const unlockByDimension = Object.fromEntries(
    compound.dimensions.map((d) => [
      d.dimension,
      target > 0 ? Math.round((target * d.lift) / 100) : 0
    ])
  ) as Record<ReadinessDimension, number>;

  return {
    target,
    projected,
    locked: target > 0 ? Math.max(0, target - projected) : 0,
    unlockByDimension
  };
}

/* ============================================================================
 * Action ranking — fastest value, not biggest gap
 * ========================================================================= */

export interface RankedDimension {
  dimension: ReadinessDimension;
  score: number;
  /** Points to 100. */
  gap: number;
  /** Compound points gained by closing the gap. */
  lift: number;
  /** Dollars unlocked by closing the gap. */
  valueUnlock: number;
  /** Dollars unlocked per readiness point of effort — the ranking key. */
  valuePerPoint: number;
  kind: 'foundation' | 'execution';
}

/**
 * Rank the five dimensions by dollars-unlocked-per-point. Ties (e.g. no target
 * set) fall back to raw compound lift, then to the size of the gap — so the
 * list is always meaningfully ordered even pre-revenue.
 */
export function rankByValue(compound: CompoundReadiness, value: ReadinessValue): RankedDimension[] {
  return compound.dimensions
    .map((d) => {
      const gap = Math.max(0, 100 - d.score);
      const valueUnlock = value.unlockByDimension[d.dimension] ?? 0;
      const valuePerPoint = gap > 0 ? valueUnlock / gap : 0;
      return {
        dimension: d.dimension,
        score: d.score,
        gap,
        lift: d.lift,
        valueUnlock,
        valuePerPoint,
        kind: d.kind
      };
    })
    .sort((a, b) => b.valuePerPoint - a.valuePerPoint || b.lift - a.lift || b.gap - a.gap);
}

/* ============================================================================
 * Forward trajectory — "compound results" made visible over time
 * ========================================================================= */

/** One future week on the projected readiness curve. */
export interface TrajectoryPoint {
  /** Weeks from now (0 = today). */
  week: number;
  /** Projected compound score that week, 0–100. */
  score: number;
  /** Projected closeable capital that week (0 when no target). */
  projected: number;
}

export interface ReadinessTrajectory {
  /** Today → horizon, inclusive of week 0. */
  points: TrajectoryPoint[];
  /** First week the curve reaches the institutional bar, or null if not within the horizon. */
  weeksToBar: number | null;
  /** First week the curve reaches 100, or null if not within the horizon. */
  weeksToMax: number | null;
  /** Points/week of progress the projection assumes. */
  pacePerWeek: number;
}

/** Default forward horizon and weekly improvement pace for the projection. */
const TRAJECTORY_WEEKS = 8;
const TRAJECTORY_PACE = 6;

/**
 * Raise the single weakest dimension by `pace` points (capped at 100). Modelling
 * "fix the gating link first" — exactly what the action ranking tells the user
 * to do — so the projected curve mirrors the advice, and synergy + the balance
 * bonus naturally accelerate it as the foundation and weakest link climb.
 */
function advanceWeakest(byDim: Record<ReadinessDimension, number>, pace: number): void {
  const order: ReadinessDimension[] = ['profile', 'proof', 'materials', 'pipeline', 'capital'];
  let weakest: ReadinessDimension | null = null;
  for (const d of order) {
    if (byDim[d] >= 100) continue;
    if (weakest === null || byDim[d] < byDim[weakest]) weakest = d;
  }
  if (weakest) byDim[weakest] = clamp100(byDim[weakest] + pace);
}

/**
 * Project the compounding curve forward. Starting from today's scores, each
 * week advances the weakest dimension by `pacePerWeek` and recomputes the
 * compound score + projected capital — so the user sees where steady execution
 * lands them, and when they cross the institutional bar. Pure: the what-if panel
 * and the server share it.
 */
export function projectTrajectory(
  breakdown: ReadinessDimensionScore[],
  target: number,
  opts: { weeks?: number; pacePerWeek?: number } = {}
): ReadinessTrajectory {
  const weeks = opts.weeks ?? TRAJECTORY_WEEKS;
  const pacePerWeek = opts.pacePerWeek ?? TRAJECTORY_PACE;

  const byDim = Object.fromEntries(
    breakdown.map((d) => [d.dimension, clamp100(d.score)])
  ) as Record<ReadinessDimension, number>;
  const weights = Object.fromEntries(breakdown.map((d) => [d.dimension, d.weight])) as Record<
    ReadinessDimension,
    number
  >;

  const points: TrajectoryPoint[] = [];
  let weeksToBar: number | null = null;
  let weeksToMax: number | null = null;

  for (let week = 0; week <= weeks; week++) {
    if (week > 0) advanceWeakest(byDim, pacePerWeek);
    const simBreakdown: ReadinessDimensionScore[] = breakdown.map((d) => ({
      ...d,
      score: byDim[d.dimension],
      contribution: (byDim[d.dimension] * weights[d.dimension]) / 100
    }));
    const { compoundScore } = computeCompoundReadiness(simBreakdown);
    points.push({ week, score: compoundScore, projected: projectValue(target, compoundScore) });
    if (weeksToBar === null && compoundScore >= INSTITUTIONAL_BAR) weeksToBar = week;
    if (weeksToMax === null && compoundScore >= 100) weeksToMax = week;
  }

  return { points, weeksToBar, weeksToMax, pacePerWeek };
}
