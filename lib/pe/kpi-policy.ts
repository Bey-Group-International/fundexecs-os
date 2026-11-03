// lib/pe/kpi-policy.ts
// KPI variance materiality (root-kpi) as numbers, with the labelled standing
// default: flag above 5% of budget. The absolute-amount floor and the trend test
// are the firm's to set; they are not defaulted. Pure.

export interface KpiPolicy {
  /** Variance is flagged at or above this percent of budget. */
  materialityPct: number;
  /** …and at or above this absolute amount, when the firm sets one. */
  materialityAbs?: number;
  /** Consecutive periods in the same adverse direction that make a trend, when set. */
  trendPeriods?: number;
}

export const DEFAULT_KPI_POLICY: KpiPolicy = { materialityPct: 5 };

const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

export function parseKpiPolicy(raw: unknown): KpiPolicy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const pct = pos(o.materialityPct);
  const abs = pos(o.materialityAbs);
  const trend = pos(o.trendPeriods);
  if (pct === undefined && abs === undefined && trend === undefined) return null;
  return { materialityPct: pct ?? DEFAULT_KPI_POLICY.materialityPct, materialityAbs: abs, trendPeriods: trend !== undefined ? Math.floor(trend) : undefined };
}
