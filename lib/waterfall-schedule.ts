// lib/waterfall-schedule.ts
// A multi-period, cumulative distribution waterfall — the fund-life complement
// to lib/waterfall.ts (a single distribution, simple pref, one carry rate).
//
// It runs a chronological schedule of LP contributions and distributions,
// tracking cumulative unreturned capital and accrued (optionally COMPOUNDING)
// preferred return, and splits each distribution ROC → pref → GP catch-up →
// TIERED carry. Tiered carry ("super-carry": a higher GP split once LPs pass a
// return multiple) is the institutional generalization of the single carry rate,
// and mirrors the return-cap / tiered-payout structures the model was adapted
// from.
//
// Pure and dependency-free so the interactive calculator runs it client-side and
// the agents reason over the same math server-side.

/** A carry tier: `carry` applies until LPs' cumulative cash reaches `upToMultiple` × paid-in. */
export interface CarryTier {
  carry: number;
  /** LP return multiple ceiling for this tier; the final tier should be Infinity. */
  upToMultiple: number;
}

export interface ScheduleTerms {
  /** Annual preferred return, e.g. 0.08. */
  prefRate: number;
  /** GP catch-up rate 0..1 (1 = full catch-up, 0 = none). */
  catchUp: number;
  /** Compound the preferred return on unpaid pref (true) vs. simple accrual (false). */
  compounding: boolean;
  /** Carry tiers, ordered ascending by `upToMultiple`; the last must be Infinity. */
  carryTiers: CarryTier[];
}

export const DEFAULT_SCHEDULE_TERMS: ScheduleTerms = {
  prefRate: 0.08,
  catchUp: 1.0,
  compounding: true,
  carryTiers: [{ carry: 0.2, upToMultiple: Infinity }],
};

/** One event in the fund timeline. Contribution is applied before distribution. */
export interface CashflowEvent {
  period: number;
  contribution?: number;
  distribution?: number;
}

export interface DistributionBreakdown {
  period: number;
  distribution: number;
  roc: number;
  prefToLps: number;
  catchUpToGp: number;
  carryToLps: number;
  carryToGp: number;
  toLps: number;
  toGp: number;
}

export interface ScheduleResult {
  paidIn: number;
  totalDistributed: number;
  totalToLps: number;
  totalToGp: number;
  /** GP's profit share (catch-up + carry), i.e. total to GP. */
  gpCarry: number;
  lpPct: number;
  gpPct: number;
  /** Distributions to LPs ÷ paid-in (DPI). */
  dpi: number;
  /** Unreturned LP capital remaining at the end. */
  unreturnedCapital: number;
  /** Accrued-but-unpaid preferred return remaining at the end. */
  accruedPrefRemaining: number;
  distributions: DistributionBreakdown[];
}

const clamp0 = (v: number): number => (v > 0 && Number.isFinite(v) ? v : 0);

/**
 * Split a residual (post ROC/pref/catch-up) across carry tiers. The GP carry
 * rate steps up as LPs' cumulative cash crosses each `upToMultiple` × paid-in
 * threshold; only the LP share advances that threshold, so we walk tier by tier.
 * Exported for isolated testing.
 */
export function splitResidualTiered(
  residual: number,
  lpReceivedSoFar: number,
  paidIn: number,
  tiers: CarryTier[],
): { lp: number; gp: number } {
  let res = clamp0(residual);
  let lpRec = clamp0(lpReceivedSoFar);
  let lp = 0;
  let gp = 0;

  for (const tier of tiers) {
    if (res <= 0) break;
    const carry = Math.min(Math.max(tier.carry, 0), 0.99);
    const lpCeiling = tier.upToMultiple * paidIn; // Infinity → unbounded
    const lpRoom = lpCeiling - lpRec;
    if (lpRoom <= 0) continue; // LPs already past this tier

    // Residual needed to lift LPs by `lpRoom` at this carry: lpRoom = (1-carry)*use.
    const resToFill = Number.isFinite(lpRoom) ? lpRoom / (1 - carry) : Infinity;
    const use = Math.min(res, resToFill);
    const lpPart = use * (1 - carry);
    const gpPart = use * carry;

    lp += lpPart;
    gp += gpPart;
    lpRec += lpPart;
    res -= use;
  }

  // Any un-tiered remainder (tiers didn't end in Infinity) goes fully to LPs.
  if (res > 0) lp += res;

  return { lp, gp };
}

/**
 * Run a full contribution/distribution schedule through the waterfall. Events
 * are processed in period order; between events, pref accrues (compounding when
 * enabled) on the unreturned balance.
 */
export function computeWaterfallSchedule(
  events: CashflowEvent[],
  terms: ScheduleTerms = DEFAULT_SCHEDULE_TERMS,
): ScheduleResult {
  const evs = [...events].sort((a, b) => a.period - b.period);
  const prefRate = clamp0(terms.prefRate);
  const catchUp = Math.min(Math.max(terms.catchUp, 0), 1);
  const tiers = terms.carryTiers.length ? terms.carryTiers : DEFAULT_SCHEDULE_TERMS.carryTiers;
  const baseCarry = Math.min(Math.max(tiers[0].carry, 0), 0.99);

  let paidIn = 0;
  let unreturned = 0;
  let accruedPref = 0;
  let toLps = 0;
  let toGp = 0;
  let totalDistributed = 0;
  let lastPeriod = evs.length ? evs[0].period : 0;

  const distributions: DistributionBreakdown[] = [];

  for (const e of evs) {
    // 1) Accrue pref over the periods elapsed since the last event.
    const dP = Math.max(0, e.period - lastPeriod);
    if (dP > 0 && prefRate > 0 && unreturned + accruedPref > 0) {
      if (terms.compounding) {
        const balance = unreturned + accruedPref;
        // The whole owed balance grows at prefRate; the increment is all pref.
        accruedPref += balance * (Math.pow(1 + prefRate, dP) - 1);
      } else {
        accruedPref += unreturned * prefRate * dP;
      }
    }
    lastPeriod = e.period;

    // 2) Contribution — new paid-in capital adds to the unreturned base.
    const contribution = clamp0(e.contribution ?? 0);
    if (contribution > 0) {
      paidIn += contribution;
      unreturned += contribution;
    }

    // 3) Distribution through the tiers.
    const distribution = clamp0(e.distribution ?? 0);
    if (distribution > 0) {
      let rem = distribution;

      const roc = Math.min(rem, unreturned);
      rem -= roc;
      unreturned -= roc;

      const pref = Math.min(rem, accruedPref);
      rem -= pref;
      accruedPref -= pref;

      const cuTarget = baseCarry < 1 ? (baseCarry / (1 - baseCarry)) * pref * catchUp : 0;
      const cu = Math.min(rem, cuTarget);
      rem -= cu;

      const split = splitResidualTiered(rem, toLps + roc + pref, paidIn, tiers);
      const distToLps = roc + pref + split.lp;
      const distToGp = cu + split.gp;

      toLps += distToLps;
      toGp += distToGp;
      totalDistributed += distribution;

      distributions.push({
        period: e.period,
        distribution,
        roc,
        prefToLps: pref,
        catchUpToGp: cu,
        carryToLps: split.lp,
        carryToGp: split.gp,
        toLps: distToLps,
        toGp: distToGp,
      });
    }
  }

  const total = toLps + toGp;
  return {
    paidIn,
    totalDistributed,
    totalToLps: toLps,
    totalToGp: toGp,
    gpCarry: toGp,
    lpPct: total > 0 ? Math.round((toLps / total) * 1000) / 10 : 0,
    gpPct: total > 0 ? Math.round((toGp / total) * 1000) / 10 : 0,
    dpi: paidIn > 0 ? Math.round((toLps / paidIn) * 100) / 100 : 0,
    unreturnedCapital: unreturned,
    accruedPrefRemaining: accruedPref,
    distributions,
  };
}
