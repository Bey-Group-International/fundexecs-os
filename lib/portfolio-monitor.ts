// lib/portfolio-monitor.ts — the Portfolio Monitor aggregator.
//
// One cross-asset performance command center over the held portfolio: every
// held asset's latest mark vs. cost, unrealized gain, MOIC, concentration, plus
// portfolio totals (NAV, cost, unrealized gain, weighted MOIC) and alerts
// (stale marks, underperformers, write-down risk). Read-only aggregation over
// the real `assets`, `valuation_marks`, and `funds` tables. Best-effort: any
// read failure degrades to an empty/zero result rather than throwing.
//
// The pure helpers (isExited / assetMoic / markAgeDays / isStaleMark /
// concentrationPct / rollupPortfolio / portfolioAlerts) carry no I/O and no
// `react` import, so they are unit-testable in jest without a DB or RSC runtime.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import type { Asset, ValuationMark, Fund } from "@/lib/supabase/database.types";
import { portfolioSeries, type SeriesPoint } from "@/lib/valuation-series";

export type { SeriesPoint };

// React's per-request cache exists only in the Next runtime; identity fallback for jest.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AlertKind = "stale_mark" | "underperformer" | "write_down_risk";
export type AlertTone = "warning" | "danger" | "info";

export interface PortfolioAlert {
  id: string;
  kind: AlertKind;
  tone: AlertTone;
  assetId: string;
  assetName: string;
  message: string;
}

export interface PortfolioAsset {
  id: string;
  name: string;
  assetType: string;
  fundId: string | null;
  fundName: string | null;
  status: string;
  cost: number | null;
  /** Latest mark value if any, else current_value, else null. */
  nav: number;
  /** Whether `nav` came from a real valuation mark. */
  hasMark: boolean;
  markAsOf: string | null;
  markAgeDays: number | null;
  isStale: boolean;
  moic: number | null;
  unrealizedGain: number | null;
  concentrationPct: number;
}

export interface PortfolioTotals {
  nav: number;
  cost: number;
  unrealizedGain: number;
  /** NAV-weighted MOIC across held assets that have a positive cost basis. */
  weightedMoic: number | null;
  heldCount: number;
}

export interface PortfolioMonitor {
  hasData: boolean;
  totals: PortfolioTotals;
  assets: PortfolioAsset[];
  alerts: PortfolioAlert[];
  /** Portfolio NAV over time, rolled up from the valuation-mark trail. */
  navSeries: SeriesPoint[];
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O — safe to import directly in tests)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Statuses that mean the position is no longer held (no NAV). */
const EXITED_STATUSES = new Set([
  "exited",
  "sold",
  "realized",
  "divested",
  "written_off",
]);

/** Number of days past which a valuation mark is considered stale. */
export const STALE_MARK_DAYS = 120;

/** True when a status (case-insensitive) denotes an exited/realized position. */
export function isExited(status: string | null | undefined): boolean {
  if (!status) return false;
  return EXITED_STATUSES.has(status.trim().toLowerCase());
}

/**
 * Multiple-on-invested-capital for an asset. Returns `null` when cost is unknown
 * or non-positive (zero-cost guard) so callers never divide by zero.
 */
export function assetMoic(
  value: number | null | undefined,
  cost: number | null | undefined,
): number | null {
  if (value == null || cost == null) return null;
  if (!Number.isFinite(value) || !Number.isFinite(cost)) return null;
  if (cost <= 0) return null;
  return value / cost;
}

/** Whole days between a mark's `as_of` date and `now`. `null` if unparseable. */
export function markAgeDays(
  asOf: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!asOf) return null;
  const then = new Date(asOf).getTime();
  if (Number.isNaN(then)) return null;
  const diff = now.getTime() - then;
  if (diff < 0) return 0;
  return Math.floor(diff / DAY_MS);
}

/** True when a mark is older than STALE_MARK_DAYS (strict boundary). */
export function isStaleMark(
  asOf: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const age = markAgeDays(asOf, now);
  if (age == null) return false;
  return age > STALE_MARK_DAYS;
}

/** An asset's share of total NAV as a percentage. Zero total → 0. */
export function concentrationPct(assetNav: number, totalNav: number): number {
  if (!Number.isFinite(assetNav) || !Number.isFinite(totalNav)) return 0;
  if (totalNav <= 0) return 0;
  return (assetNav / totalNav) * 100;
}

/** A minimal asset shape the rollup needs (subset of the full Asset row). */
export interface RollupAsset {
  id: string;
  status: string;
  acquisition_cost: number | null;
  current_value: number | null;
}

/**
 * Aggregate held (non-exited) assets into portfolio totals. NAV per asset is the
 * latest valuation mark when present, else `current_value`, else 0. Weighted
 * MOIC is the NAV-weighted average MOIC across assets with a positive cost.
 */
export function rollupPortfolio(
  assets: RollupAsset[],
  latestMarkByAssetId: Map<string, number>,
): PortfolioTotals {
  let nav = 0;
  let cost = 0;
  let weightedNumerator = 0;
  let weightedNavWithCost = 0;
  let heldCount = 0;

  for (const a of assets) {
    if (isExited(a.status)) continue;
    heldCount += 1;
    const mark = latestMarkByAssetId.get(a.id);
    const assetNav = mark != null ? mark : a.current_value ?? 0;
    nav += assetNav;
    if (a.acquisition_cost != null) cost += a.acquisition_cost;

    const moic = assetMoic(assetNav, a.acquisition_cost);
    if (moic != null) {
      weightedNumerator += moic * assetNav;
      weightedNavWithCost += assetNav;
    }
  }

  const weightedMoic =
    weightedNavWithCost > 0 ? weightedNumerator / weightedNavWithCost : null;

  return {
    nav,
    cost,
    unrealizedGain: nav - cost,
    weightedMoic,
    heldCount,
  };
}

/** Threshold below which a held asset's MOIC flags it as an underperformer. */
export const UNDERPERFORMER_MOIC = 1;
/** MOIC at/below which a held asset is flagged as write-down risk. */
export const WRITE_DOWN_MOIC = 0.7;

/**
 * Derive alerts for a set of held portfolio assets: stale marks, underperformers
 * (MOIC < 1), and write-down risk (MOIC <= 0.7). Exited positions are skipped.
 */
export function portfolioAlerts(rows: PortfolioAsset[]): PortfolioAlert[] {
  const alerts: PortfolioAlert[] = [];
  for (const row of rows) {
    if (isExited(row.status)) continue;

    if (row.isStale && row.markAgeDays != null) {
      alerts.push({
        id: `stale:${row.id}`,
        kind: "stale_mark",
        tone: "warning",
        assetId: row.id,
        assetName: row.name,
        message: `Mark is ${row.markAgeDays} days old — re-mark recommended.`,
      });
    }

    if (row.moic != null && row.moic <= WRITE_DOWN_MOIC) {
      alerts.push({
        id: `writedown:${row.id}`,
        kind: "write_down_risk",
        tone: "danger",
        assetId: row.id,
        assetName: row.name,
        message: `Marked at ${row.moic.toFixed(2)}x cost — write-down risk.`,
      });
    } else if (row.moic != null && row.moic < UNDERPERFORMER_MOIC) {
      alerts.push({
        id: `under:${row.id}`,
        kind: "underperformer",
        tone: "info",
        assetId: row.id,
        assetName: row.name,
        message: `Below cost at ${row.moic.toFixed(2)}x.`,
      });
    }
  }
  return alerts;
}

// ---------------------------------------------------------------------------
// Aggregator (I/O)
// ---------------------------------------------------------------------------

const EMPTY: PortfolioMonitor = {
  hasData: false,
  totals: {
    nav: 0,
    cost: 0,
    unrealizedGain: 0,
    weightedMoic: null,
    heldCount: 0,
  },
  assets: [],
  alerts: [],
  navSeries: [],
};

/** Reduce all marks for the org to the latest (max as_of) value per asset. */
function latestMarks(marks: ValuationMark[]): Map<string, ValuationMark> {
  const byAsset = new Map<string, ValuationMark>();
  for (const m of marks) {
    const existing = byAsset.get(m.asset_id);
    if (!existing || m.as_of > existing.as_of) byAsset.set(m.asset_id, m);
  }
  return byAsset;
}

/**
 * Read the org's held portfolio: every non-exited asset with its latest mark,
 * MOIC, concentration, and the portfolio totals + alerts. Best-effort — any
 * failure returns the empty/zero result.
 *
 * Wrapped in `cache` so multiple consumers in one RSC render share the read.
 */
export const getPortfolioMonitor = cache(
  async (orgId: string): Promise<PortfolioMonitor> => {
    if (!orgId) return EMPTY;
    try {
      const supabase = await createServerClient();

      const { data: assetRows } = await supabase
        .from("assets")
        .select(
          "id, name, asset_type, fund_id, acquisition_date, acquisition_cost, current_value, status",
        )
        .eq("organization_id", orgId)
        .is("archived_at", null);

      const allAssets = (assetRows ?? []) as Asset[];
      const held = allAssets.filter((a) => !isExited(a.status));
      if (held.length === 0) return EMPTY;

      const heldIds = held.map((a) => a.id);

      const { data: markRows } = await supabase
        .from("valuation_marks")
        .select("id, asset_id, value, as_of, organization_id, method, note, created_at, created_by")
        .eq("organization_id", orgId)
        .in("asset_id", heldIds);

      const marks = (markRows ?? []) as ValuationMark[];
      const latestByAsset = latestMarks(marks);

      const { data: fundRows } = await supabase
        .from("funds")
        .select("id, name")
        .eq("organization_id", orgId);
      const fundNameById = new Map<string, string>(
        ((fundRows ?? []) as Pick<Fund, "id" | "name">[]).map((f) => [
          f.id,
          f.name,
        ]),
      );

      const now = new Date();

      // NAV per asset for totals + concentration.
      const navByAsset = new Map<string, number>();
      for (const a of held) {
        const mark = latestByAsset.get(a.id);
        navByAsset.set(a.id, mark ? mark.value : a.current_value ?? 0);
      }

      const totals = rollupPortfolio(held, navByAsset);

      const portfolioAssets: PortfolioAsset[] = held.map((a) => {
        const mark = latestByAsset.get(a.id);
        const nav = navByAsset.get(a.id) ?? 0;
        const ageDays = mark ? markAgeDays(mark.as_of, now) : null;
        const moic = assetMoic(nav, a.acquisition_cost);
        const unrealizedGain =
          a.acquisition_cost != null ? nav - a.acquisition_cost : null;
        return {
          id: a.id,
          name: a.name,
          assetType: a.asset_type,
          fundId: a.fund_id,
          fundName: a.fund_id ? fundNameById.get(a.fund_id) ?? null : null,
          status: a.status,
          cost: a.acquisition_cost,
          nav,
          hasMark: !!mark,
          markAsOf: mark ? mark.as_of : null,
          markAgeDays: ageDays,
          isStale: mark ? isStaleMark(mark.as_of, now) : false,
          moic,
          unrealizedGain,
          concentrationPct: concentrationPct(nav, totals.nav),
        };
      });

      portfolioAssets.sort((a, b) => b.nav - a.nav);

      const alerts = portfolioAlerts(portfolioAssets);

      // Portfolio NAV over time, rolled up from the held assets' mark trail.
      const navSeries = portfolioSeries(
        held.map((a) => ({
          id: a.id,
          acquisition_date: a.acquisition_date,
          acquisition_cost: a.acquisition_cost,
          current_value: a.current_value,
        })),
        marks.map((m) => ({ asset_id: m.asset_id, as_of: m.as_of, value: m.value })),
      );

      return {
        hasData: true,
        totals,
        assets: portfolioAssets,
        alerts,
        navSeries,
      };
    } catch {
      return EMPTY;
    }
  },
);
