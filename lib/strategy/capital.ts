/* ============================================================================
 * lib/strategy/capital.ts — capital-weighted aggregation for the operating plan.
 *
 * Phase 2b of memory/STRATEGY_COMPOUNDING_BLUEPRINT.md, decision #2
 * (capital-weighted scoring) with the hybrid model: weight each objective by the
 * real value-at-stake when it links to a deal (`capital_weight`), and fall back
 * to a priority proxy otherwise. So the posture rollup aggregates actual dollars
 * where they're known and degrades gracefully — never fabricating a figure — to
 * "higher priority = more weight" where they aren't. Pure and deterministic,
 * like lib/lifecycle.ts; unit-tested.
 * ========================================================================= */

export type Priority = 'High' | 'Medium' | 'Low';
export type ObjectiveSource = 'manual' | 'signal' | 'lifecycle' | 'cascade';

/**
 * Priority → capital proxy weight. The fallback when an objective carries no
 * linked dollar value, so the plan still reflects value at stake, not raw count.
 */
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

export interface CapitalWeighted {
  priority: Priority;
  /** Real value-at-stake from a linked deal, when known; null/undefined otherwise. */
  capitalWeight?: number | null;
}

/**
 * Hybrid capital weight: the real value-at-stake from a linked deal when it's a
 * positive, finite number, otherwise the priority proxy. A zero/negative/NaN
 * weight falls back to the proxy so a malformed link can never silently drop an
 * objective out of the rollup.
 */
export function capitalWeightOf(o: CapitalWeighted): number {
  const w = o.capitalWeight;
  if (typeof w === 'number' && Number.isFinite(w) && w > 0) return w;
  return PRIORITY_WEIGHT[o.priority];
}

/**
 * Capital-weighted average completion across a set of objectives, 0–100. Each
 * objective contributes `pct` scaled by its hybrid capital weight, over the
 * total weight. Returns 0 for an empty set (no plan authored yet).
 */
export function weightedCompletion(list: Array<CapitalWeighted & { pct: number }>): number {
  const total = list.reduce((s, o) => s + capitalWeightOf(o), 0);
  if (total === 0) return 0;
  const earned = list.reduce((s, o) => s + o.pct * capitalWeightOf(o), 0);
  return Math.round(earned / total);
}

/**
 * A pending draft is an Earn/specialist-proposed objective awaiting the
 * operator's approval: it came from a non-manual source AND hasn't been approved
 * yet. Manual objectives — and any pre-migration row where `source` is absent —
 * are always live, never hidden behind the review inbox. This is the predicate
 * that splits the "your team drafted N moves" queue from the live plan.
 */
export function isPendingDraft(o: {
  source?: ObjectiveSource | string | null;
  approved?: boolean | null;
}): boolean {
  return o.approved === false && o.source != null && o.source !== 'manual';
}
