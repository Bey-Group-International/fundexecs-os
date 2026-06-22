// Execute-hub exit & scenario modeling — the question Carta's cap-table product
// can't answer: at what exit do the LPs clear their preferred return, and what
// does the GP take home? Runs a proposed exit value through the distribution
// waterfall and annualizes the return over the hold, then sweeps a grid of exit
// multiples so the operator sees the whole payoff curve at once. Pure: builds on
// the same waterfall engine the calculator uses client-side.
import { computeWaterfall, DEFAULT_TERMS, type WaterfallTerms, type WaterfallResult } from "@/lib/waterfall";

export interface ExitScenario {
  label: string;
  exitValue: number; // gross proceeds at exit
  grossMultiple: number | null; // exitValue / cost basis
  irr: number | null; // annualized gross return over the hold, percent (1dp)
  waterfall: WaterfallResult;
  toLps: number; // LP share after the waterfall
  toGp: number; // GP carry + catch-up
  lpMultiple: number | null; // toLps / paid-in
  lpIrr: number | null; // LP net annualized return over the hold, percent
}

/**
 * Annualized return turning `inV` into `outV` over `years`: (out/in)^(1/y) − 1,
 * expressed as a percentage to one decimal. Null when undefined (zero/negative
 * inputs or no hold period).
 */
export function annualizedReturn(inV: number, outV: number, years: number): number | null {
  if (inV <= 0 || outV <= 0 || years <= 0 || !Number.isFinite(years)) return null;
  return Math.round((Math.pow(outV / inV, 1 / years) - 1) * 1000) / 10;
}

/**
 * Model a single exit: run `exitValue` through the waterfall (paid-in is the
 * return-of-capital + pref base; the hold accrues pref), then derive gross and
 * LP-net multiples and IRRs. No I/O.
 */
export function modelExit(
  cost: number,
  exitValue: number,
  years: number,
  paidIn: number,
  terms: WaterfallTerms = DEFAULT_TERMS,
  label?: string,
): ExitScenario {
  const waterfall = computeWaterfall(exitValue, paidIn, terms, Math.max(years, 1));
  const grossMultiple = cost > 0 && exitValue > 0 ? Math.round((exitValue / cost) * 100) / 100 : null;
  const lpMultiple = paidIn > 0 ? Math.round((waterfall.totalToLps / paidIn) * 100) / 100 : null;
  return {
    label: label ?? (grossMultiple != null ? `${grossMultiple.toFixed(1)}× exit` : "Exit"),
    exitValue,
    grossMultiple,
    irr: annualizedReturn(cost, exitValue, years),
    waterfall,
    toLps: waterfall.totalToLps,
    toGp: waterfall.totalToGp,
    lpMultiple,
    lpIrr: annualizedReturn(paidIn, waterfall.totalToLps, years),
  };
}

export const DEFAULT_MULTIPLES = [0.5, 1, 1.5, 2, 3, 5];

/**
 * Sweep a grid of exit multiples (applied to the cost basis) plus the current
 * mark, returning a scenario per point sorted by exit value. The current-mark
 * scenario is tagged so the UI can anchor the payoff curve to today's NAV.
 */
export function scenarioGrid(
  cost: number,
  currentValue: number,
  years: number,
  paidIn: number,
  terms: WaterfallTerms = DEFAULT_TERMS,
  multiples: number[] = DEFAULT_MULTIPLES,
): ExitScenario[] {
  const points: ExitScenario[] = multiples
    .filter((m) => m > 0 && cost > 0)
    .map((m) => modelExit(cost, cost * m, years, paidIn, terms, `${m}× cost`));

  if (currentValue > 0) {
    points.push(modelExit(cost, currentValue, years, paidIn, terms, "Current mark"));
  }

  return points.sort((a, b) => a.exitValue - b.exitValue);
}
