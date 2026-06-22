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

// One pre-aggregated bucket of *implicit* digest engagement for a
// (entityKind, moveKind) pair. Counts come from a GROUP BY over
// radar_digest_engagement (0064). Folded into the same learned weights as the
// explicit feedback, weighted down (clicks > opens, both < an explicit accept).
export interface EngagementAggregate {
  entityKind: string;
  moveKind: RadarMoveKind | string;
  clicked: number;
  opened: number;
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

// --- Implicit engagement weights --------------------------------------------
// Engagement (digest opens + clicks) is a softer, implicit signal than an
// explicit accept/dismiss: the operator never said "yes", they just engaged. So
// each engagement event counts as a FRACTION of an explicit verdict when folded
// into the same acceptance ratio. A click — taking the move straight from the
// brief — is a strong "this was worth surfacing"; an open is a weak positive.
// Both are positive-only: not engaging is ambiguous (busy, offline), never a
// dismiss, so engagement only ever raises confidence, never manufactures a
// negative.
const CLICK_WEIGHT = 0.5; // a click ≈ half an explicit accept
const OPEN_WEIGHT = 0.15; // an open ≈ a small fraction of an accept

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function weightKey(entityKind: string, moveKind: RadarMoveKind | string): string {
  return `${entityKind}:${moveKind}`;
}

// Map one bucket's verdicts to a bounded additive delta. Returns 0 below the
// confidence floor. The acceptance ratio is computed against weighted negatives
// (dismiss = 1, snooze = 0.5); a ratio of 1 → +MAX, 0 → -MAX, 0.5 (neutral) → 0.
//
// Optional implicit engagement (clicks/opens) folds in as fractional positive
// "accepts": a click adds CLICK_WEIGHT, an open OPEN_WEIGHT to BOTH the accepted
// count and the confidence total. Engagement is positive-only and can therefore
// help a thin bucket clear the floor, but — being weighted down — it never
// overrides a strong explicit signal. Omitting `eng` leaves behavior IDENTICAL
// to the explicit-only loop (existing callers + tests are unaffected).
// Pure + deterministic.
export function aggregateDelta(agg: RadarAggregate, eng?: EngagementAggregate | null): number {
  const accepted = Math.max(0, agg.accepted);
  const dismissed = Math.max(0, agg.dismissed);
  const snoozed = Math.max(0, agg.snoozed);

  const clicked = eng ? Math.max(0, eng.clicked) : 0;
  const opened = eng ? Math.max(0, eng.opened) : 0;
  const implicitPositive = CLICK_WEIGHT * clicked + OPEN_WEIGHT * opened;

  // Confidence floor counts every contributing event: explicit verdicts at full
  // weight, engagement at its fractional weight. With no engagement this is the
  // exact prior total, so the gating is byte-identical.
  const total = accepted + dismissed + snoozed + implicitPositive;
  if (total < MIN_FEEDBACK) return 0;

  const negatives = dismissed + SNOOZE_WEIGHT * snoozed;
  const denom = accepted + implicitPositive + negatives;
  if (denom <= 0) return 0;

  // 0..1 acceptance ratio → -1..+1 signed score, then scale to the clamp band.
  const ratio = (accepted + implicitPositive) / denom;
  const signed = ratio * 2 - 1;
  const delta = Math.round(signed * MAX_ADJUSTMENT);
  return clamp(delta, -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
}

// Fold an array of aggregates into LearnedWeights. Buckets below the floor or with a
// zero delta are omitted, so an absent key cleanly means "no learned opinion yet".
//
// Optional `engagement` adds implicit digest signals, joined per
// (entityKind, moveKind) key. A bucket present only in engagement (no explicit
// feedback yet) is still scored — engagement alone can tune the ranking once it
// clears the floor. Omitting `engagement` is byte-identical to the prior 1-arg
// call, so existing callers and tests are unchanged.
// Pure + deterministic (same input → same output).
export function computeLearnedWeights(
  aggregates: RadarAggregate[],
  engagement?: EngagementAggregate[] | null,
): LearnedWeights {
  const deltas: Record<string, number> = {};

  if (!engagement || engagement.length === 0) {
    for (const agg of aggregates) {
      const delta = aggregateDelta(agg);
      if (delta !== 0) deltas[weightKey(agg.entityKind, agg.moveKind)] = delta;
    }
    return { deltas, active: Object.keys(deltas).length > 0 };
  }

  // Index engagement by key so each explicit bucket can pick up its implicit pair.
  const engByKey = new Map<string, EngagementAggregate>();
  for (const e of engagement) {
    const key = weightKey(e.entityKind, e.moveKind);
    const prev = engByKey.get(key);
    if (prev) {
      prev.clicked += Math.max(0, e.clicked);
      prev.opened += Math.max(0, e.opened);
    } else {
      engByKey.set(key, {
        entityKind: e.entityKind,
        moveKind: e.moveKind,
        clicked: Math.max(0, e.clicked),
        opened: Math.max(0, e.opened),
      });
    }
  }

  const seen = new Set<string>();
  for (const agg of aggregates) {
    const key = weightKey(agg.entityKind, agg.moveKind);
    seen.add(key);
    const delta = aggregateDelta(agg, engByKey.get(key) ?? null);
    if (delta !== 0) deltas[key] = delta;
  }

  // Engagement-only buckets (no explicit feedback) — score them on engagement alone.
  for (const [key, eng] of engByKey) {
    if (seen.has(key)) continue;
    const emptyAgg: RadarAggregate = {
      entityKind: eng.entityKind,
      moveKind: eng.moveKind as RadarMoveKind,
      accepted: 0,
      dismissed: 0,
      snoozed: 0,
    };
    const delta = aggregateDelta(emptyAgg, eng);
    if (delta !== 0) deltas[key] = delta;
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
