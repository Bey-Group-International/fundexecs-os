// lib/lp-report.ts — the LP Report aggregator + pure PE helpers.
//
// Assembles a print-ready, fund-level quarterly LP report for the org: a
// capital summary (committed / paid-in / distributed / NAV / uncalled), the
// standard performance multiples (TVPI / DPI / RVPI / MOIC), a portfolio
// holdings table, and a capital-activity summary (contributions vs.
// distributions). Best-effort: any read failure degrades to empty/zero rather
// than throwing, so the page always renders.
//
// The pure helpers (isExited / safeRatio / computeMultiples / currentQuarterLabel
// / rollupFunds / holdingsRows) carry no I/O and no `react` import, so they are
// unit-testable in jest without a DB or RSC runtime. The aggregator composes
// them.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import { portfolioSeries } from "@/lib/valuation-series";
import type { SeriesPoint, MarkLike } from "@/lib/valuation-series";
import type {
  Fund,
  Asset,
  CapitalEvent,
  Commitment,
  ValuationMark,
} from "@/lib/supabase/database.types";

// React's per-request `cache` is provided by the Next.js runtime; fall back to
// an identity wrapper outside it (e.g. unit tests) so this module loads anywhere.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LpMultiples {
  tvpi: number;
  dpi: number;
  rvpi: number;
  moic: number;
}

export interface LpCapitalSummary {
  committed: number;
  paidIn: number;
  distributed: number;
  nav: number;
  uncalled: number;
  currency: string;
}

export interface LpHolding {
  id: string;
  name: string;
  assetType: string;
  cost: number;
  currentValue: number;
  moic: number;
  status: string;
  exited: boolean;
}

export interface LpCapitalActivity {
  contributionsCount: number;
  contributionsTotal: number;
  distributionsCount: number;
  distributionsTotal: number;
}

/** A single fund's per-fund capital line for the LP breakdown table. */
export interface LpFundRow {
  id: string;
  name: string;
  committed: number;
  called: number;
  distributed: number;
  currency: string;
}

/** Contributions vs. distributions net, derived from capital activity. */
export interface LpCashflow {
  contributionsTotal: number;
  distributionsTotal: number;
  net: number;
}

export interface LpReport {
  period: string;
  generatedAt: string;
  fundCount: number;
  capital: LpCapitalSummary;
  multiples: LpMultiples;
  holdings: LpHolding[];
  activity: LpCapitalActivity;
  /** Portfolio NAV over time, derived from valuation marks (best-effort). */
  navSeries: SeriesPoint[];
  /** Per-fund capital breakdown rows. */
  funds: LpFundRow[];
  hasData: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — safe to import directly in tests)
// ---------------------------------------------------------------------------

const EXITED_STATUSES = new Set([
  "exited",
  "sold",
  "realized",
  "divested",
  "written_off",
]);

/** True when an asset's status denotes a realized/exited position. */
export function isExited(status: string | null | undefined): boolean {
  if (!status) return false;
  return EXITED_STATUSES.has(status.trim().toLowerCase());
}

/** Safe division that returns 0 for a zero (or non-finite) denominator. */
export function safeRatio(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : 0;
}

/**
 * Standard PE multiples from NAV, distributions, and paid-in capital.
 * TVPI = (nav + distributed) / paidIn; DPI = distributed / paidIn;
 * RVPI = nav / paidIn; MOIC = (nav + distributed) / paidIn (same basis here).
 * Divide-by-zero guarded to 0.
 */
export function computeMultiples({
  nav,
  distributed,
  paidIn,
}: {
  nav: number;
  distributed: number;
  paidIn: number;
}): LpMultiples {
  const totalValue = nav + distributed;
  return {
    tvpi: safeRatio(totalValue, paidIn),
    dpi: safeRatio(distributed, paidIn),
    rvpi: safeRatio(nav, paidIn),
    moic: safeRatio(totalValue, paidIn),
  };
}

/** Calendar-quarter label like "Q2 2026" for `now` (defaults to current time). */
export function currentQuarterLabel(now: Date = new Date()): string {
  const quarter = Math.floor(now.getMonth() / 3) + 1;
  return `Q${quarter} ${now.getFullYear()}`;
}

export interface FundRollup {
  committed: number;
  paidIn: number;
  distributed: number;
  currency: string;
}

/**
 * Roll fund rows up into org totals. paidIn is sourced consistently from
 * `fund.called_capital` (not capital_events) to keep one authoritative basis.
 * Currency is taken from the first fund with one, defaulting to USD.
 */
export function rollupFunds(funds: Fund[]): FundRollup {
  let committed = 0;
  let paidIn = 0;
  let distributed = 0;
  let currency = "";
  for (const f of funds) {
    committed += f.committed_capital ?? 0;
    paidIn += f.called_capital ?? 0;
    distributed += f.distributed_capital ?? 0;
    if (!currency && f.currency) currency = f.currency;
  }
  return { committed, paidIn, distributed, currency: currency || "USD" };
}

/** Map asset rows into holding rows with a per-asset MOIC (value / cost). */
export function holdingsRows(assets: Asset[]): LpHolding[] {
  return assets.map((a) => {
    const cost = a.acquisition_cost ?? 0;
    const currentValue = a.current_value ?? 0;
    const exited = isExited(a.status);
    return {
      id: a.id,
      name: a.name,
      assetType: a.asset_type,
      cost,
      currentValue,
      moic: safeRatio(currentValue, cost),
      status: a.status,
      exited,
    };
  });
}

/** Summarize capital events into contribution vs. distribution counts/sums. */
export function summarizeActivity(events: CapitalEvent[]): LpCapitalActivity {
  let contributionsCount = 0;
  let contributionsTotal = 0;
  let distributionsCount = 0;
  let distributionsTotal = 0;
  for (const e of events) {
    if (e.event_type === "capital_call" || e.event_type === "contribution") {
      contributionsCount += 1;
      contributionsTotal += e.amount ?? 0;
    } else if (
      e.event_type === "distribution" ||
      e.event_type === "return_of_capital"
    ) {
      distributionsCount += 1;
      distributionsTotal += e.amount ?? 0;
    }
  }
  return {
    contributionsCount,
    contributionsTotal,
    distributionsCount,
    distributionsTotal,
  };
}

/**
 * Map fund rows into per-fund breakdown rows (name, committed, called,
 * distributed, currency). Each fund defaults its own currency to USD.
 */
export function fundBreakdown(funds: Fund[]): LpFundRow[] {
  return funds.map((f) => ({
    id: f.id,
    name: f.name,
    committed: f.committed_capital ?? 0,
    called: f.called_capital ?? 0,
    distributed: f.distributed_capital ?? 0,
    currency: f.currency || "USD",
  }));
}

/**
 * Net cashflow from capital activity: contributions in, distributions out, and
 * the net (distributions − contributions). Positive net means more cash returned
 * to LPs than called.
 */
export function netCashflow(activity: LpCapitalActivity): LpCashflow {
  const contributionsTotal = activity.contributionsTotal ?? 0;
  const distributionsTotal = activity.distributionsTotal ?? 0;
  return {
    contributionsTotal,
    distributionsTotal,
    net: distributionsTotal - contributionsTotal,
  };
}

// ---------------------------------------------------------------------------
// Aggregator (I/O)
// ---------------------------------------------------------------------------

/**
 * Build the org's LP report. Reads funds / assets / capital_events scoped to the
 * org and composes the pure helpers above. Best-effort: any failure degrades to
 * an empty/zero report rather than throwing, so the route always renders.
 *
 * paidIn is taken from summed `fund.called_capital` (preferred source). NAV is
 * the sum of `current_value` over NON-exited assets only. uncalled is floored at 0.
 *
 * Wrapped in `cache` so multiple consumers in one RSC render share the read.
 */
export const getLpReport = cache(async (orgId: string): Promise<LpReport> => {
  const generatedAt = new Date().toISOString();
  const period = currentQuarterLabel();

  const empty: LpReport = {
    period,
    generatedAt,
    fundCount: 0,
    capital: {
      committed: 0,
      paidIn: 0,
      distributed: 0,
      nav: 0,
      uncalled: 0,
      currency: "USD",
    },
    multiples: { tvpi: 0, dpi: 0, rvpi: 0, moic: 0 },
    holdings: [],
    activity: {
      contributionsCount: 0,
      contributionsTotal: 0,
      distributionsCount: 0,
      distributionsTotal: 0,
    },
    navSeries: [],
    funds: [],
    hasData: false,
  };

  if (!orgId) return empty;

  try {
    const supabase = await createServerClient();

    const [fundsRes, assetsRes, eventsRes] = await Promise.all([
      supabase.from("funds").select("*").eq("organization_id", orgId),
      supabase.from("assets").select("*").eq("organization_id", orgId),
      supabase.from("capital_events").select("*").eq("organization_id", orgId),
    ]);

    const funds = (fundsRes.data ?? []) as Fund[];
    const assets = (assetsRes.data ?? []) as Asset[];
    const events = (eventsRes.data ?? []) as CapitalEvent[];

    // NAV-over-time from the valuation-marks audit trail. Best-effort: a read
    // failure (or missing table) degrades to an empty series, never throws.
    let navSeries: SeriesPoint[] = [];
    try {
      const marksRes = await supabase
        .from("valuation_marks")
        .select("*")
        .eq("organization_id", orgId);
      const marks = (marksRes.data ?? []) as ValuationMark[];
      const markLikes: MarkLike[] = marks.map((m) => ({
        asset_id: m.asset_id,
        as_of: m.as_of,
        value: m.value,
      }));
      navSeries = portfolioSeries(assets, markLikes);
    } catch {
      navSeries = [];
    }

    const roll = rollupFunds(funds);
    const holdings = holdingsRows(assets);

    // NAV: current value of NON-exited assets only.
    const nav = holdings
      .filter((h) => !h.exited)
      .reduce((sum, h) => sum + h.currentValue, 0);

    const multiples = computeMultiples({
      nav,
      distributed: roll.distributed,
      paidIn: roll.paidIn,
    });

    const uncalled = Math.max(0, roll.committed - roll.paidIn);
    const activity = summarizeActivity(events);

    const hasData = funds.length > 0 || assets.length > 0;

    return {
      period,
      generatedAt,
      fundCount: funds.length,
      capital: {
        committed: roll.committed,
        paidIn: roll.paidIn,
        distributed: roll.distributed,
        nav,
        uncalled,
        currency: roll.currency,
      },
      multiples,
      holdings,
      activity,
      navSeries,
      funds: fundBreakdown(funds),
      hasData,
    };
  } catch {
    return empty;
  }
});

// Silence unused-import lint while keeping the Commitment type available for
// future per-investor breakdowns; the report is fund-level today.
export type { Commitment };
