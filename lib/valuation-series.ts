// Execute-hub valuation series: turns the valuation_marks audit trail into time
// series — per holding, and rolled up to portfolio NAV over time. Pure and
// dependency-free so it runs anywhere and stays unit-testable; the latest mark
// is reconciled with the asset's current value so the series always ends on the
// number shown everywhere else.
import { num } from "@/lib/format";

export interface SeriesPoint {
  date: string; // ISO yyyy-mm-dd
  value: number;
}

export interface AssetLike {
  id: string;
  acquisition_date: string | null;
  acquisition_cost: number | null;
  current_value: number | null;
}

export interface MarkLike {
  asset_id: string;
  as_of: string;
  value: number;
}

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Build one holding's value series: acquisition cost (if known) → each recorded
 * mark → the current value. Deduped by date (latest entry wins), sorted ascending.
 */
export function assetSeries(asset: AssetLike, marks: MarkLike[]): SeriesPoint[] {
  const byDate = new Map<string, number>();

  if (asset.acquisition_date && num(asset.acquisition_cost) > 0) {
    byDate.set(asset.acquisition_date, num(asset.acquisition_cost));
  }
  for (const m of [...marks].sort((a, b) => (a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : 0))) {
    byDate.set(m.as_of, num(m.value));
  }

  const ordered = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  // Reconcile the tail with the asset's current value: if it differs from the
  // last known point, append it at today so the series ends on the live number.
  if (asset.current_value != null) {
    const cur = num(asset.current_value);
    const last = ordered[ordered.length - 1];
    if (!last || last[1] !== cur) {
      const d = last && last[0] > today() ? last[0] : today();
      const i = ordered.findIndex(([dd]) => dd === d);
      if (i >= 0) ordered[i] = [d, cur];
      else ordered.push([d, cur]);
    }
  }

  return ordered.map(([date, value]) => ({ date, value }));
}

/** The last value at or before a date in an ascending series, or null. */
function valueAsOf(series: SeriesPoint[], date: string): number | null {
  let v: number | null = null;
  for (const p of series) {
    if (p.date <= date) v = p.value;
    else break;
  }
  return v;
}

/**
 * Roll holdings up into a portfolio NAV-over-time series: at every date any
 * holding moved, sum each holding's last-known value (carry-forward). Holdings
 * not yet on the book at a date contribute nothing.
 */
export function portfolioSeries(assets: AssetLike[], marks: MarkLike[]): SeriesPoint[] {
  const series = assets.map((a) => assetSeries(a, marks.filter((m) => m.asset_id === a.id)));
  const dates = [...new Set(series.flatMap((s) => s.map((p) => p.date)))].sort();
  return dates.map((date) => ({
    date,
    value: series.reduce((sum, s) => sum + (valueAsOf(s, date) ?? 0), 0),
  }));
}
