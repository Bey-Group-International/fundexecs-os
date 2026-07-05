// lib/proactive/learn.ts
// The Learn stage — dismiss / snooze / approve are training signals. A
// proposed-Command type that keeps getting dismissed decays out of the trust
// budget; one that keeps getting approved recovers. This keeps initiative
// honest over time: Earn stops proposing what the operator keeps rejecting.
//
// Pure and deterministic (mirrors lib/radar-learning.ts): given the feedback
// tally per trigger key, produce a bounded multiplier the prioritizer folds
// into the composite score. No I/O — the caller supplies the counts.

import { LEARNING } from "./config";
import type { ProactiveVerdict } from "./types";

export interface FeedbackTally {
  approved: number;
  dismissed: number;
  snoozed: number;
}

export function emptyTally(): FeedbackTally {
  return { approved: 0, dismissed: 0, snoozed: 0 };
}

export function tallyVerdict(tally: FeedbackTally, verdict: ProactiveVerdict): FeedbackTally {
  return { ...tally, [verdict]: tally[verdict] + 1 };
}

/**
 * Learned multiplier for a trigger key from its feedback tally. A snooze counts
 * as a fractional dismissal (soft negative). Below the confidence floor the
 * weight is neutral (1.0) — we don't learn from too little. The result is
 * clamped to [minWeight, maxWeight] so learning nudges, never zeroes, a signal.
 *
 *   weight = clamp( (approved - snoozeWeight*snoozed - dismissed) / total
 *                   mapped into [minWeight, maxWeight] around 1.0 )
 */
export function learnedWeight(tally: FeedbackTally): number {
  const total = tally.approved + tally.dismissed + tally.snoozed;
  if (total < LEARNING.minFeedback) return 1.0;

  const net = tally.approved - LEARNING.snoozeWeight * tally.snoozed - tally.dismissed;
  const ratio = net / total; // in [-1, 1]

  // Map ratio 0 → 1.0, ratio 1 → maxWeight, ratio -1 → minWeight.
  const weight =
    ratio >= 0
      ? 1.0 + ratio * (LEARNING.maxWeight - 1.0)
      : 1.0 + ratio * (1.0 - LEARNING.minWeight);

  return Math.max(LEARNING.minWeight, Math.min(LEARNING.maxWeight, weight));
}

/** Build a per-trigger weight map from a list of decided items. */
export function learnedWeights(
  decisions: Array<{ triggerKey: string; verdict: ProactiveVerdict }>,
): Record<string, number> {
  const tallies = new Map<string, FeedbackTally>();
  for (const d of decisions) {
    const t = tallies.get(d.triggerKey) ?? emptyTally();
    tallies.set(d.triggerKey, tallyVerdict(t, d.verdict));
  }
  const out: Record<string, number> = {};
  for (const [key, tally] of tallies) out[key] = learnedWeight(tally);
  return out;
}
