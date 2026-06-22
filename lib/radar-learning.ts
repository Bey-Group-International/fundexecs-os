// lib/radar-learning.ts
// The Radar learning loop — the layer that makes the Source Radar (lib/source-radar.ts)
// get smarter the more it's used. The radar's base score (radarScore) is pure and
// static. This module turns the operator's accept/dismiss/snooze verdicts into a
// bounded, explainable adjustment per (entityKind, moveKind) combination: nudge the
// score UP for combos the operator consistently acts on, DOWN for ones they keep
// dismissing. Snoozes are mild negative signal (not now, but not wrong).
//
// PURE + deterministic — no DB, no clock, no key. The DB compositor aggregates the
// radar_feedback table (0061) into RadarAggregate[] and passes the computed weights
// into buildRadar. Default behavior (no weights) leaves scoring byte-identical.
//
// Design: simple and explainable on purpose. An acceptance rate above 50% pushes
// up, below pushes down, scaled by how far from neutral and clamped to a small band
// (±MAX_ADJUSTMENT). A confidence floor (MIN_FEEDBACK) means a single click never
// moves the ranking — the loop only speaks once it has seen enough.

import type { RadarMoveKind } from "@/lib/source-radar";

// One pre-aggregated bucket of feedback for a (entityKind, moveKind) pair. Counts
// come straight from a GROUP BY over radar_feedback; this module never touches a DB.
export interface RadarAggregate {
  entityKind: string;
  moveKind: RadarMoveKind;
  accepted: number;
  dismissed: number;
  snoozed: number;
}

// The learned, bounded adjustments keyed by "entityKind:moveKind". A positive delta
// raises an item's score; negative lowers it. Absent key → no adjustment.
export interface LearnedWeights {
  /** Additive score delta per "entityKind:moveKind" key, clamped to ±MAX_ADJUSTMENT. */
  deltas: Record<string, number>;
  /** True once any bucket cleared the confidence floor and produced a delta. */
  active: boolean;
}

// Below this many total verdicts for a bucket we make NO adjustment — one or two
// clicks should never reshuffle the ranking.
export const MIN_FEEDBACK = 4;
// The learned delta is clamped to this band so the loop tunes, never overrides, the
// base score (which leads on propensity + fit).
export const MAX_ADJUSTMENT = 15;
// A snooze is weaker negative signal than an outright dismiss.
const SNOOZE_WEIGHT = 0.5;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function weightKey(entityKind: string, moveKind: RadarMoveKind | string): string {
  return `${entityKind}:${moveKind}`;
}

// Map one bucket's verdicts to a bounded additive delta. Returns 0 below the
// confidence floor. The acceptance ratio is computed against weighted negatives
// (dismiss = 1, snooze = 0.5); a ratio of 1 → +MAX, 0 → -MAX, 0.5 (neutral) → 0.
// Pure + deterministic.
export function aggregateDelta(agg: RadarAggregate): number {
  const accepted = Math.max(0, agg.accepted);
  const dismissed = Math.max(0, agg.dismissed);
  const snoozed = Math.max(0, agg.snoozed);
  const total = accepted + dismissed + snoozed;
  if (total < MIN_FEEDBACK) return 0;

  const negatives = dismissed + SNOOZE_WEIGHT * snoozed;
  const denom = accepted + negatives;
  if (denom <= 0) return 0;

  // 0..1 acceptance ratio → -1..+1 signed score, then scale to the clamp band.
  const ratio = accepted / denom;
  const signed = ratio * 2 - 1;
  const delta = Math.round(signed * MAX_ADJUSTMENT);
  return clamp(delta, -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
}

// Fold an array of aggregates into LearnedWeights. Buckets below the floor or with a
// zero delta are omitted, so an absent key cleanly means "no learned opinion yet".
// Pure + deterministic (same input → same output).
export function computeLearnedWeights(aggregates: RadarAggregate[]): LearnedWeights {
  const deltas: Record<string, number> = {};
  for (const agg of aggregates) {
    const delta = aggregateDelta(agg);
    if (delta !== 0) deltas[weightKey(agg.entityKind, agg.moveKind)] = delta;
  }
  return { deltas, active: Object.keys(deltas).length > 0 };
}

// Apply the learned delta for an item's (kind, moveKind) on top of its base score,
// re-clamped to 0–100. No matching weight → base score unchanged. Pure.
export function applyLearnedAdjustment(
  baseScore: number,
  kind: string,
  moveKind: RadarMoveKind,
  weights?: LearnedWeights | null,
): number {
  if (!weights) return baseScore;
  const delta = weights.deltas[weightKey(kind, moveKind)] ?? 0;
  if (delta === 0) return baseScore;
  return clamp(Math.round(baseScore + delta), 0, 100);
}
