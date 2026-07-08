// lib/lbo-model.ts
// A leveraged-buyout returns engine — the full chain the existing per-case
// underwriting calculator (lib/underwriting-calc.ts) deliberately skips:
// entry EV → debt/equity split → year-by-year operating cash flow → debt
// paydown (cash sweep) → exit EV → exit equity → IRR / MOIC, plus a
// value-creation bridge (EBITDA growth vs. multiple change vs. deleveraging).
//
// The point of a leveraged model is that debt AMPLIFIES equity returns: the
// simple equity-in / equity-out CAGR in underwriting-calc ignores leverage by
// design, so this sits alongside it, not on top of it.
//
// Pure module: no React, no DB, no I/O. Deterministic and null-safe — degenerate
// inputs return nulls rather than throwing so the UI renders an em-dash.
// Structured to mirror lib/fund-scoring.ts (typed inputs, documented curve of
// logic, explainable outputs).

/** Ex-ante inputs for a single LBO scenario. */
export interface LboInputs {
  /** Entry-year EBITDA in USD (e.g. 40_000_000). */
  entryEbitda: number;
  /** Entry EV as a multiple of entry EBITDA (e.g. 5.0). */
  entryMultiple: number;
  /** Share of entry EV funded with debt, as a fraction 0..1 (e.g. 0.6). */
  debtPct: number;
  /** Cash interest rate on the debt, as a fraction (e.g. 0.10). */
  interestRate: number;
  /** Hold period in whole years (e.g. 5). */
  holdYears: number;
  /** Exit EV as a multiple of exit-year EBITDA (e.g. 5.0). */
  exitMultiple: number;
  /** Entry-year revenue in USD (e.g. 100_000_000). */
  revenue: number;
  /** Annual revenue growth, as a fraction (e.g. 0.10). */
  revenueGrowth: number;
  /** EBITDA margin, as a fraction of revenue (e.g. 0.40). */
  ebitdaMargin: number;
  /** D&A as a fraction of revenue (e.g. 0.20). */
  daPctRevenue: number;
  /** CapEx as a fraction of revenue (e.g. 0.15). */
  capexPctRevenue: number;
  /** Incremental net working capital as a fraction of the revenue increase (e.g. 0.10). */
  nwcPctRevenueChange: number;
  /** Cash tax rate, as a fraction (e.g. 0.40). */
  taxRate: number;
}

/** One projected year of the operating model and debt schedule. */
export interface LboYear {
  year: number;
  revenue: number;
  ebitda: number;
  ebit: number;
  interest: number;
  tax: number;
  /** Unlevered-plus-tax free cash flow available to sweep debt. */
  fcf: number;
  /** Debt repaid this year (cash sweep, capped at cash available and balance). */
  debtPaydown: number;
  /** Debt outstanding at year end. */
  endingDebt: number;
}

/** Attribution of equity value creation into its three classic drivers. */
export interface LboBridge {
  /** Value from growing EBITDA at the entry multiple. */
  ebitdaGrowth: number;
  /** Value from a change in the valuation multiple, on exit EBITDA. */
  multipleExpansion: number;
  /** Value from paying down debt over the hold. */
  debtPaydown: number;
}

export interface LboResult {
  entryEV: number;
  entryDebt: number;
  entryEquity: number;
  exitEbitda: number;
  exitEV: number;
  endingDebt: number;
  exitEquity: number;
  /** Multiple on invested equity (exitEquity / entryEquity). */
  moic: number | null;
  /** Annualized IRR as a fraction (single equity outflow → inflow, so exact). */
  irr: number | null;
  schedule: LboYear[];
  bridge: LboBridge;
}

/** A sensible starting scenario for the UI — a classic mid-market buyout. */
export function defaultLboInputs(): LboInputs {
  return {
    entryEbitda: 40_000_000,
    entryMultiple: 5,
    debtPct: 0.6,
    interestRate: 0.1,
    holdYears: 5,
    exitMultiple: 5,
    revenue: 100_000_000,
    revenueGrowth: 0.1,
    ebitdaMargin: 0.4,
    daPctRevenue: 0.2,
    capexPctRevenue: 0.15,
    nwcPctRevenueChange: 0.1,
    taxRate: 0.4,
  };
}

function finite(...xs: number[]): boolean {
  return xs.every((x) => Number.isFinite(x));
}

const EMPTY_BRIDGE: LboBridge = { ebitdaGrowth: 0, multipleExpansion: 0, debtPaydown: 0 };

/**
 * Run the LBO. Guards degenerate inputs (non-finite, non-positive entry EBITDA
 * or multiple, hold < 1, debt share outside [0,1)) by returning a structurally
 * complete result with null MOIC/IRR and an empty schedule.
 */
export function computeLbo(inp: LboInputs): LboResult {
  const holdYears = Math.floor(inp.holdYears);

  const invalid =
    !finite(
      inp.entryEbitda,
      inp.entryMultiple,
      inp.debtPct,
      inp.interestRate,
      inp.exitMultiple,
      inp.revenue,
      inp.revenueGrowth,
      inp.ebitdaMargin,
      inp.daPctRevenue,
      inp.capexPctRevenue,
      inp.nwcPctRevenueChange,
      inp.taxRate,
    ) ||
    inp.entryEbitda <= 0 ||
    inp.entryMultiple <= 0 ||
    inp.exitMultiple <= 0 ||
    holdYears < 1 ||
    inp.debtPct < 0 ||
    inp.debtPct >= 1;

  const entryEV = inp.entryMultiple * inp.entryEbitda;
  const entryDebt = Math.max(0, inp.debtPct) * entryEV;
  const entryEquity = entryEV - entryDebt;

  if (invalid || entryEquity <= 0) {
    const exitEbitda = inp.ebitdaMargin * inp.revenue;
    return {
      entryEV,
      entryDebt,
      entryEquity,
      exitEbitda,
      exitEV: inp.exitMultiple * exitEbitda,
      endingDebt: entryDebt,
      exitEquity: 0,
      moic: null,
      irr: null,
      schedule: [],
      bridge: EMPTY_BRIDGE,
    };
  }

  const schedule: LboYear[] = [];
  let debt = entryDebt;
  let prevRevenue = inp.revenue;

  for (let year = 1; year <= holdYears; year++) {
    const revenue = inp.revenue * Math.pow(1 + inp.revenueGrowth, year);
    const ebitda = inp.ebitdaMargin * revenue;
    const da = inp.daPctRevenue * revenue;
    const ebit = ebitda - da;
    const interest = inp.interestRate * debt;
    const ebt = ebit - interest;
    // No tax benefit on a pre-tax loss (conservative; no NOL carryforward modeled).
    const tax = ebt > 0 ? ebt * inp.taxRate : 0;
    const netIncome = ebt - tax;
    const capex = inp.capexPctRevenue * revenue;
    const deltaNwc = inp.nwcPctRevenueChange * (revenue - prevRevenue);
    const fcf = netIncome + da - capex - deltaNwc;
    // Cash sweep: pay down as much debt as this year's positive FCF allows,
    // never below zero. A cash shortfall (fcf < 0) simply pays nothing here.
    const debtPaydown = Math.max(0, Math.min(fcf, debt));
    debt -= debtPaydown;

    schedule.push({
      year,
      revenue,
      ebitda,
      ebit,
      interest,
      tax,
      fcf,
      debtPaydown,
      endingDebt: debt,
    });
    prevRevenue = revenue;
  }

  const exitEbitda = inp.ebitdaMargin * inp.revenue * Math.pow(1 + inp.revenueGrowth, holdYears);
  const exitEV = inp.exitMultiple * exitEbitda;
  const endingDebt = debt;
  const exitEquity = Math.max(0, exitEV - endingDebt);

  const moic = exitEquity / entryEquity;
  const irr = moic > 0 ? Math.pow(moic, 1 / holdYears) - 1 : null;

  // Value bridge: the three components sum exactly to (exitEquity − entryEquity).
  const bridge: LboBridge = {
    ebitdaGrowth: (exitEbitda - inp.entryEbitda) * inp.entryMultiple,
    multipleExpansion: (inp.exitMultiple - inp.entryMultiple) * exitEbitda,
    debtPaydown: entryDebt - endingDebt,
  };

  return {
    entryEV,
    entryDebt,
    entryEquity,
    exitEbitda,
    exitEV,
    endingDebt,
    exitEquity,
    moic,
    irr,
    schedule,
    bridge,
  };
}
