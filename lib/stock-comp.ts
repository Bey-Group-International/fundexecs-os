// lib/stock-comp.ts
// ASC 718 stock-based compensation expense engine for employee equity grants
// on the firm's own (Build-hub) entities. Straight-line attribution of a grant's
// grant-date fair value over its service/vesting period. Grant-date fair value
// PER unit is an INPUT (no Black-Scholes here) — multiply by units for total cost.
// Pure and dependency-free so the agents and the UI run the same expensing math.

export interface Grant {
  /** units / options granted */
  units: number;
  /** grant-date fair value per unit (input — e.g. from a Black-Scholes model upstream) */
  fairValuePerUnit: number;
  /** grant date, ISO string (YYYY-MM-DD) */
  grantDate: string;
  /** vesting / service term in months */
  vestingMonths: number;
  /** optional expected forfeiture rate, 0–1, that scales total cost (no true-up) */
  forfeitureRate?: number;
}

export interface RecognitionResult {
  totalCost: number; // total comp cost to recognize over the term (net of forfeiture)
  recognized: number; // expense recognized straight-line to date
  remaining: number; // unrecognized cost still to be expensed
  vestedFraction: number; // 0–1 share of the term elapsed at asOf
}

export interface StockCompRollup {
  totalCost: number; // sum of all grants' total cost
  recognized: number; // sum recognized to date
  remaining: number; // sum still unrecognized
  grants: number; // number of grants in the rollup
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round0 = (v: number): number => Math.round(v);

/** Whole + fractional calendar months between two ISO dates (0 if from >= to or invalid). */
function monthsBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  const ft = from.getTime();
  const tt = to.getTime();
  if (!Number.isFinite(ft) || !Number.isFinite(tt) || tt <= ft) return 0;

  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  // fractional remainder within the trailing month, by day-of-month
  let dayDelta = to.getUTCDate() - from.getUTCDate();
  if (dayDelta < 0) {
    months -= 1;
    // length of the month preceding `to`, to normalize the fractional part
    const prevMonthDays = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0),
    ).getUTCDate();
    dayDelta += prevMonthDays;
  }
  const frac = dayDelta / 30; // approximate within-month fraction
  return Math.max(0, months + frac);
}

/**
 * Total compensation cost to recognize for a grant: units × grant-date fair
 * value per unit, optionally scaled down by an expected forfeiture rate.
 */
export function totalCompCost(grant: Grant): number {
  const units = num(grant.units);
  const fv = num(grant.fairValuePerUnit);
  const gross = units > 0 && fv > 0 ? units * fv : 0;
  const keep = 1 - clamp(num(grant.forfeitureRate), 0, 1);
  return round2(gross * keep);
}

/**
 * Straight-line expense recognized for a grant as of a date.
 *
 * Math:
 *   elapsed       = calendar months from grantDate to asOf (>= 0)
 *   vestedFraction= clamp(elapsed / vestingMonths, 0, 1)   (1 once fully vested)
 *   recognized    = totalCost × vestedFraction
 *   remaining     = totalCost − recognized
 *
 * A zero/negative vesting term means the cost is recognized immediately once
 * the grant date has passed.
 */
export function recognizedExpense(grant: Grant, asOf: string): RecognitionResult {
  const totalCost = totalCompCost(grant);
  const term = num(grant.vestingMonths);
  const elapsed = monthsBetween(grant.grantDate, asOf);

  const vestedFraction =
    term > 0
      ? clamp(elapsed / term, 0, 1)
      : elapsed > 0 || asOf >= grant.grantDate
        ? 1
        : 0;

  const recognized = round2(totalCost * vestedFraction);
  return {
    totalCost,
    recognized,
    remaining: round2(totalCost - recognized),
    vestedFraction: Math.round(vestedFraction * 10000) / 10000,
  };
}

/**
 * Expense recognized within a specific period (e.g. a quarter or fiscal year):
 * recognized(periodEnd) − recognized(periodStart). Never negative.
 */
export function periodExpense(
  grant: Grant,
  periodStart: string,
  periodEnd: string,
): number {
  const start = recognizedExpense(grant, periodStart).recognized;
  const end = recognizedExpense(grant, periodEnd).recognized;
  return round2(Math.max(0, end - start));
}

/** Portfolio rollup: total cost, recognized to date, and remaining unrecognized. */
export function rollupStockComp(grants: Grant[], asOf: string): StockCompRollup {
  const list = grants ?? [];
  let totalCost = 0;
  let recognized = 0;
  for (const g of list) {
    const r = recognizedExpense(g, asOf);
    totalCost += r.totalCost;
    recognized += r.recognized;
  }
  return {
    totalCost: round2(totalCost),
    recognized: round2(recognized),
    remaining: round2(totalCost - recognized),
    grants: round0(list.length),
  };
}
