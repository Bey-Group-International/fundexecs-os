/* ============================================================================
 * lib/queries/intelligence-calibration.ts — the self-aware read model.
 *
 * Pure + isomorphic (no server-only deps) so both the server loaders and the
 * client inbox views can share the exact same calibration math.
 *
 * Pure, dependency-free functions that turn an org's actioned matches into a
 * calibration summary: how many decisions it has learned from, how cleanly the
 * score separates accepts from dismisses, and which factor has earned the most
 * trust. Computed in TypeScript from rows both inboxes already load, so the
 * "getting smarter" surfaces light up the moment there is decision history —
 * no extra round-trip, no schema dependency.
 *
 * The matching server-side learning (per-factor multipliers) lives in the
 * `recompute_match_scoring_weights` SQL function; this is its read-side mirror.
 * ========================================================================= */

export interface CalibrationFactor {
  factor: string;
  weight: number;
}

export interface CalibrationInput {
  score: number;
  status: string;
  factors?: CalibrationFactor[];
}

export type CalibrationStage = 'cold' | 'calibrating' | 'tuned';

export interface IntelligenceCalibration {
  /** Accept + dismiss decisions the model has learned from. */
  decisions: number;
  accepted: number;
  dismissed: number;
  /** 0..1 share of decisions that were accepts. */
  acceptanceRate: number;
  avgAcceptedScore: number | null;
  avgDismissedScore: number | null;
  /** avgAccepted − avgDismissed: how well the score separates the two. */
  separation: number | null;
  stage: CalibrationStage;
  /** Factor whose weight most distinguishes accepts from dismisses. */
  topFactor: { factor: string; lift: number } | null;
}

/** Neutral calibration for empty / unauthenticated render paths. */
export const EMPTY_CALIBRATION: IntelligenceCalibration = {
  decisions: 0,
  accepted: 0,
  dismissed: 0,
  acceptanceRate: 0,
  avgAcceptedScore: null,
  avgDismissedScore: null,
  separation: null,
  stage: 'cold',
  topFactor: null
};

/** Below this, the model stays neutral — mirrors the SQL `_min_decisions`. */
const MIN_DECISIONS = 3;
/** At/above this the model is considered well-tuned to the org. */
const TUNED_DECISIONS = 12;

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeCalibration(items: CalibrationInput[]): IntelligenceCalibration {
  const accepted = items.filter((i) => i.status === 'accepted');
  const dismissed = items.filter((i) => i.status === 'dismissed');
  const decisions = accepted.length + dismissed.length;

  const avgAcceptedScore = avg(accepted.map((i) => i.score));
  const avgDismissedScore = avg(dismissed.map((i) => i.score));
  const separation =
    avgAcceptedScore != null && avgDismissedScore != null
      ? Math.round((avgAcceptedScore - avgDismissedScore) * 10) / 10
      : null;

  const stage: CalibrationStage =
    decisions < MIN_DECISIONS ? 'cold' : decisions < TUNED_DECISIONS ? 'calibrating' : 'tuned';

  return {
    decisions,
    accepted: accepted.length,
    dismissed: dismissed.length,
    acceptanceRate: decisions > 0 ? accepted.length / decisions : 0,
    avgAcceptedScore: avgAcceptedScore != null ? Math.round(avgAcceptedScore) : null,
    avgDismissedScore: avgDismissedScore != null ? Math.round(avgDismissedScore) : null,
    separation,
    stage,
    topFactor: topFactor(accepted, dismissed)
  };
}

/** Factor with the largest positive accept-minus-dismiss average weight. */
function topFactor(
  accepted: CalibrationInput[],
  dismissed: CalibrationInput[]
): { factor: string; lift: number } | null {
  if (accepted.length === 0 || dismissed.length === 0) return null;

  const accByFactor = factorAverages(accepted);
  const disByFactor = factorAverages(dismissed);

  let best: { factor: string; lift: number } | null = null;
  for (const [factor, accAvg] of accByFactor) {
    const disAvg = disByFactor.get(factor);
    if (disAvg == null) continue;
    const lift = Math.round((accAvg - disAvg) * 10) / 10;
    if (lift > 0 && (best === null || lift > best.lift)) best = { factor, lift };
  }
  return best;
}

function factorAverages(items: CalibrationInput[]): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const item of items) {
    for (const f of item.factors ?? []) {
      if (!f.factor || f.factor === 'match_reason' || f.factor === 'ai_judge') continue;
      const prev = sums.get(f.factor) ?? { total: 0, n: 0 };
      prev.total += f.weight;
      prev.n += 1;
      sums.set(f.factor, prev);
    }
  }
  const out = new Map<string, number>();
  for (const [factor, { total, n }] of sums) out.set(factor, n > 0 ? total / n : 0);
  return out;
}

export interface MatchConfidence {
  value: number;
  band: 'high' | 'medium' | 'low' | 'unknown';
}

/**
 * Resolve a single match's confidence band against what the org has actually
 * accepted. Before the model is calibrated, the band is `unknown` and the
 * meter simply reflects the raw score.
 */
export function matchConfidence(score: number, cal: IntelligenceCalibration): MatchConfidence {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  if (cal.stage === 'cold' || cal.avgAcceptedScore == null) {
    return { value, band: 'unknown' };
  }
  const accepted = cal.avgAcceptedScore;
  const dismissed = cal.avgDismissedScore ?? Math.max(0, accepted - 15);
  const midpoint = (accepted + dismissed) / 2;
  if (score >= accepted) return { value, band: 'high' };
  if (score >= midpoint) return { value, band: 'medium' };
  return { value, band: 'low' };
}
