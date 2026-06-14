/* ============================================================================
 * lib/intelligence/conversion.ts — Pipeline Conversion Analytics.
 *
 * A proprietary, key-free funnel read: stage-to-stage conversion and where the
 * pipeline leaks. Built from the canonical formation stages and the current
 * deal distribution the OS already holds — no external APIs, no model.
 *
 * A deal's current stage implies it has passed through every earlier stage, so
 * "reached" is the cumulative count at-or-past each stage; conversion from one
 * stage to the next is reached[next] / reached[stage]. The largest single drop
 * is surfaced as the biggest leak — the operator's highest-leverage fix.
 *
 * Pure + total — trivially unit-testable.
 * ========================================================================= */

/** A formation stage with the count of deals CURRENTLY sitting in it. */
export interface StageCount {
  key: string;
  label: string;
  /** Deals whose current stage is exactly this one. */
  count: number;
}

export interface FunnelStage {
  key: string;
  label: string;
  /** Deals at or past this stage (cumulative). */
  reached: number;
  /** Deals currently sitting in this stage. */
  here: number;
  /** % of the previous stage's reach that made it here (100 for the entry stage). */
  conversionFromPrev: number;
  /** 100 − conversionFromPrev, the share lost at this step. */
  dropOff: number;
}

export interface ConversionLeak {
  fromLabel: string;
  toLabel: string;
  /** Conversion across this single transition (0–100). */
  conversionPct: number;
  /** Deals lost across this transition. */
  lost: number;
}

export interface ConversionAnalytics {
  stages: FunnelStage[];
  /** Total deals that entered the funnel (reach at the top stage). */
  totalDeals: number;
  /** End-to-end conversion: deals committed-or-beyond ÷ deals entered (0–100). */
  overallConversionPct: number;
  /** The single transition with the steepest drop among stages that had inflow. */
  biggestLeak: ConversionLeak | null;
  headline: string;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Build the conversion funnel from the ordered stage counts (top → bottom).
 * `committedKey` marks the stage that counts as "won" for the overall rate.
 * Pure.
 */
export function computeConversion(
  stages: StageCount[],
  committedKey = 'committed'
): ConversionAnalytics {
  const n = stages.length;

  // Cumulative reach: reached[i] = Σ counts[j] for j ≥ i.
  const reached = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    const here = Math.max(0, stages[i]?.count ?? 0);
    reached[i] = here + (i + 1 < n ? reached[i + 1] : 0);
  }

  const funnel: FunnelStage[] = stages.map((s, i) => {
    const prevReach = i > 0 ? reached[i - 1] : reached[i];
    const conversionFromPrev =
      i === 0 ? 100 : prevReach > 0 ? clampPct((reached[i] / prevReach) * 100) : 0;
    return {
      key: s.key,
      label: s.label,
      reached: reached[i],
      here: Math.max(0, s.count ?? 0),
      conversionFromPrev,
      dropOff: 100 - conversionFromPrev
    };
  });

  // Biggest leak: the steepest transition where deals both entered upstream AND
  // some progressed downstream. A stage that is simply the funnel's current
  // frontier (nothing has reached past it yet) is not a leak.
  let biggestLeak: ConversionLeak | null = null;
  for (let i = 1; i < n; i += 1) {
    const prevReach = reached[i - 1];
    if (prevReach <= 0 || reached[i] <= 0) continue;
    const conversionPct = clampPct((reached[i] / prevReach) * 100);
    const lost = prevReach - reached[i];
    if (lost <= 0) continue;
    if (!biggestLeak || conversionPct < biggestLeak.conversionPct) {
      biggestLeak = {
        fromLabel: stages[i - 1].label,
        toLabel: stages[i].label,
        conversionPct,
        lost
      };
    }
  }

  const totalDeals = reached[0] ?? 0;
  const committedIdx = stages.findIndex((s) => s.key === committedKey);
  const won = committedIdx >= 0 ? reached[committedIdx] : 0;
  const overallConversionPct = totalDeals > 0 ? clampPct((won / totalDeals) * 100) : 0;

  const headline =
    totalDeals === 0
      ? 'No deals in the funnel yet'
      : biggestLeak
        ? `${biggestLeak.conversionPct}% convert ${biggestLeak.fromLabel} → ${biggestLeak.toLabel} — the funnel's biggest leak`
        : `${overallConversionPct}% of ${totalDeals} deals reach committed`;

  return {
    stages: funnel,
    totalDeals,
    overallConversionPct,
    biggestLeak,
    headline
  };
}
