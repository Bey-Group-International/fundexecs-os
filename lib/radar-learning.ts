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

// One pre-aggregated bucket of *real outcome* attribution for a move_kind. This is
// the hardest signal in the loop: not what got clicked, but what actually converted.
// It's derived from lib/radar-attribution.ts `buildAttribution`, which traces every
// ACCEPTED recommendation forward through the funnel (accepted → contacted → replied
// → met → mandate). Attribution is keyed by move_kind ONLY (it has no entity_kind),
// so an OutcomeAggregate is too — the loop applies its delta to every entity_kind
// that shares the move_kind. `accepted` is the confidence base (analogous to total
// feedback for the floor); `mandate` is the count that actually landed.
export interface OutcomeAggregate {
  moveKind: RadarMoveKind | string;
  accepted: number;
  mandate: number;
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

// --- Real-outcome (attribution) weights -------------------------------------
// The outcome signal asks the only question that ultimately matters: of the moves
// the operator ACCEPTED for this move_kind, how many became a mandate? It's folded
// in as a SEPARATE, bounded delta layered on top of the feedback/engagement delta
// (then re-clamped together to ±MAX_ADJUSTMENT), driven by the accepted→mandate
// conversion rate measured against a neutral baseline:
//   conversion > baseline → positive (this kind genuinely converts → boost it)
//   conversion ≈ 0 with enough accepted volume → negative (it fizzles → damp it)
// Gated by its own confidence floor: a move_kind needs enough ACCEPTED samples
// before a thin, noisy conversion rate is allowed to move the ranking.
//
// MIN_OUTCOME_ACCEPTED — the outcome floor, analogous to MIN_FEEDBACK. Below this
// many accepted moves we make NO outcome adjustment (a single mandate off two
// accepts is not a trend).
export const MIN_OUTCOME_ACCEPTED = 4;
// The conversion rate (0..1) treated as "neutral" — at this rate the outcome delta
// is ~zero. Mandate conversion is rare, so the bar that counts as "genuinely
// converting" sits low; clearing it is a strong positive signal.
const OUTCOME_BASELINE = 0.15;
// The outcome delta is itself clamped to this band before being layered onto the
// feedback/engagement delta, so a single hot/cold streak can tune but never
// dominate — the combined total is still re-clamped to ±MAX_ADJUSTMENT.
const OUTCOME_MAX = 10;

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

// Map one move_kind's real-outcome attribution to a bounded additive delta.
// Returns 0 below the outcome confidence floor (MIN_OUTCOME_ACCEPTED) so a thin,
// noisy conversion never moves the ranking. The accepted→mandate conversion is
// compared to OUTCOME_BASELINE: at the baseline the delta is ~0, well above it is
// positive (this kind converts → boost), and zero conversion with real accepted
// volume is negative (it fizzles → damp). Scaled so beating the baseline by the
// same margin it has to fall to reach zero both saturate OUTCOME_MAX. Clamped to
// ±OUTCOME_MAX. Pure + deterministic.
export function outcomeDelta(out: OutcomeAggregate): number {
  const accepted = Math.max(0, out.accepted);
  const mandate = Math.max(0, out.mandate);
  if (accepted < MIN_OUTCOME_ACCEPTED) return 0;

  // Mandates can't exceed accepts; guard against dirty data so the rate stays 0..1.
  const conversion = Math.min(1, mandate / accepted);
  // Signed distance from the neutral baseline, normalized so:
  //   conversion = 0          → -1   (full damp)
  //   conversion = baseline   →  0   (neutral)
  //   conversion = 1          → +1   (full boost)
  const signed =
    conversion >= OUTCOME_BASELINE
      ? (conversion - OUTCOME_BASELINE) / (1 - OUTCOME_BASELINE)
      : (conversion - OUTCOME_BASELINE) / OUTCOME_BASELINE;
  const delta = Math.round(signed * OUTCOME_MAX);
  return clamp(delta, -OUTCOME_MAX, OUTCOME_MAX);
}

// Fold an array of aggregates into LearnedWeights. Buckets below the floor or with a
// zero delta are omitted, so an absent key cleanly means "no learned opinion yet".
//
// Optional `engagement` adds implicit digest signals, joined per
// (entityKind, moveKind) key. A bucket present only in engagement (no explicit
// feedback yet) is still scored — engagement alone can tune the ranking once it
// clears the floor.
//
// Optional `outcomes` adds the real accepted→mandate conversion per move_kind
// (from attribution). Because attribution has no entity_kind, an outcome delta is
// applied to EVERY entity_kind that shares its move_kind: it's layered on top of
// the feedback/engagement delta for each such key, then the combined total is
// re-clamped to ±MAX_ADJUSTMENT. An outcome-only move_kind (no feedback and no
// engagement) is NOT introduced as a new key — there's no entity_kind to attach
// it to and no base score it would tune — so outcomes only ever sharpen keys the
// other signals already surface.
//
// Omitting both optional args is byte-identical to the prior 1-arg call, and
// omitting `outcomes` is byte-identical to the prior 2-arg call, so existing
// callers and tests are unchanged. Pure + deterministic (same input → same output).
export function computeLearnedWeights(
  aggregates: RadarAggregate[],
  engagement?: EngagementAggregate[] | null,
  outcomes?: OutcomeAggregate[] | null,
): LearnedWeights {
  const deltas: Record<string, number> = {};

  // Index outcomes by move_kind so any key sharing that move can pick up its
  // conversion delta. Counts are summed if a move_kind appears more than once.
  const outDeltaByMove = new Map<string, number>();
  if (outcomes && outcomes.length > 0) {
    const accByMove = new Map<string, OutcomeAggregate>();
    for (const o of outcomes) {
      const mk = String(o.moveKind);
      const prev = accByMove.get(mk);
      if (prev) {
        prev.accepted += Math.max(0, o.accepted);
        prev.mandate += Math.max(0, o.mandate);
      } else {
        accByMove.set(mk, {
          moveKind: o.moveKind,
          accepted: Math.max(0, o.accepted),
          mandate: Math.max(0, o.mandate),
        });
      }
    }
    for (const [mk, o] of accByMove) {
      const d = outcomeDelta(o);
      if (d !== 0) outDeltaByMove.set(mk, d);
    }
  }

  // Layer the move_kind's outcome delta onto a base delta, re-clamped to the band.
  // No outcome for that move → base delta untouched (byte-identical to before).
  const withOutcome = (moveKind: RadarMoveKind | string, base: number): number => {
    const od = outDeltaByMove.get(String(moveKind)) ?? 0;
    if (od === 0) return base;
    return clamp(base + od, -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
  };

  if (!engagement || engagement.length === 0) {
    for (const agg of aggregates) {
      const delta = withOutcome(agg.moveKind, aggregateDelta(agg));
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
    const delta = withOutcome(agg.moveKind, aggregateDelta(agg, engByKey.get(key) ?? null));
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
    const delta = withOutcome(eng.moveKind, aggregateDelta(emptyAgg, eng));
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
