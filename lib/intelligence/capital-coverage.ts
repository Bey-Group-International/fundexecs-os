/* ============================================================================
 * lib/intelligence/capital-coverage.ts — Capital Coverage & Concentration.
 *
 * A proprietary, key-free portfolio-risk read on the live pipeline: how much of
 * the pipeline's target value is already committed (coverage), where the capital
 * exposure sits by formation stage, and how concentrated that exposure is in a
 * handful of deals (single-name + top-N share + a Herfindahl index). No external
 * APIs, no model — every number is derived from deal sizes the OS already holds.
 *
 * An allocator's two standing questions, answered deterministically: "how funded
 * is my book?" and "how much rides on one name?" Pure + total — unit-testable.
 * ========================================================================= */

/** The minimal deal shape the read needs — a structural subset of PipelineDeal. */
export interface CoverageDealInput {
  id: string;
  name: string;
  stage: string;
  status: string;
  /** The deal's target/round size; null or 0 means unsized. */
  amount: number | null;
}

export type ConcentrationBand = 'Diversified' | 'Balanced' | 'Concentrated' | 'Highly concentrated';

export interface StageExposure {
  stage: string;
  /** Sum of live deal amounts in this stage. */
  total: number;
  /** Share of total live exposure (0–100, rounded). */
  share: number;
  dealCount: number;
}

export interface DealConcentration {
  dealId: string;
  dealName: string;
  amount: number;
  /** Share of total live exposure (0–100, rounded). */
  share: number;
}

export interface CapitalCoverage {
  /** Total committed capital across the pipeline. */
  committed: number;
  /** Total pipeline target value. */
  pipelineValue: number;
  /** committed / pipelineValue as a 0–100 %. */
  coveragePct: number;
  /** The gap still to raise — max(pipelineValue − committed, 0). */
  uncommitted: number;
  /** Total live exposure used for the concentration math. */
  totalExposure: number;
  /** Number of sized live deals contributing to exposure. */
  sizedDeals: number;
  /** Per-stage exposure, largest share first. */
  byStage: StageExposure[];
  /** Largest single deal (null when no sized live deals). */
  topDeal: DealConcentration | null;
  /** Combined share of the top 3 deals (0–100, rounded). */
  top3Share: number;
  /** Herfindahl–Hirschman Index over deal shares, 0–10000. */
  hhi: number;
  /** Concentration band derived from single-name share + HHI. */
  band: ConcentrationBand;
  /** One-line risk read / lever. */
  headline: string;
}

function isClosed(d: CoverageDealInput): boolean {
  return (d.status || '').toLowerCase() === 'closed' || (d.stage || '').toLowerCase() === 'closed';
}

function amountOf(d: CoverageDealInput): number {
  return Number.isFinite(d.amount) && (d.amount as number) > 0 ? (d.amount as number) : 0;
}

function pct(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.round(Math.max(0, Math.min(100, (part / whole) * 100)));
}

/** Single-name share drives the band; HHI escalates a borderline book. */
function bandFor(topShare: number, hhi: number): ConcentrationBand {
  if (topShare >= 50 || hhi >= 4000) return 'Highly concentrated';
  if (topShare >= 35 || hhi >= 2500) return 'Concentrated';
  if (topShare >= 20 || hhi >= 1500) return 'Balanced';
  return 'Diversified';
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * Compute coverage + concentration over the live pipeline. `pipelineValue` and
 * `committed` are the OS's own portfolio totals; exposure/concentration is
 * derived from the live deals' own sizes. Pure.
 */
export function computeCapitalCoverage(
  deals: CoverageDealInput[],
  pipelineValue: number,
  committed: number
): CapitalCoverage {
  const live = deals.filter((d) => !isClosed(d));
  const sized = live.filter((d) => amountOf(d) > 0);
  const totalExposure = sized.reduce((s, d) => s + amountOf(d), 0);

  // Per-stage exposure.
  const stageTotals = new Map<string, { total: number; count: number }>();
  for (const d of sized) {
    const key = d.stage || 'unknown';
    const cur = stageTotals.get(key) ?? { total: 0, count: 0 };
    cur.total += amountOf(d);
    cur.count += 1;
    stageTotals.set(key, cur);
  }
  const byStage: StageExposure[] = [...stageTotals.entries()]
    .map(([stage, v]) => ({
      stage,
      total: v.total,
      share: pct(v.total, totalExposure),
      dealCount: v.count
    }))
    .sort((a, b) => b.total - a.total || a.stage.localeCompare(b.stage));

  // Single-name + top-N concentration, ranked by size.
  const ranked = [...sized].sort(
    (a, b) => amountOf(b) - amountOf(a) || a.name.localeCompare(b.name)
  );
  const topDeal: DealConcentration | null = ranked[0]
    ? {
        dealId: ranked[0].id,
        dealName: ranked[0].name,
        amount: amountOf(ranked[0]),
        share: pct(amountOf(ranked[0]), totalExposure)
      }
    : null;
  const top3Share = pct(
    ranked.slice(0, 3).reduce((s, d) => s + amountOf(d), 0),
    totalExposure
  );

  // Herfindahl–Hirschman Index: Σ(share fraction)² × 10000.
  const hhi =
    totalExposure > 0
      ? Math.round(
          sized.reduce((s, d) => {
            const frac = amountOf(d) / totalExposure;
            return s + frac * frac;
          }, 0) * 10000
        )
      : 0;

  // Classify on the UNROUNDED top-deal share so a 49.6% deal can't round up to
  // 50% and falsely escalate the band. The rounded `share` is display-only.
  const topShareRaw =
    topDeal && totalExposure > 0 ? (amountOf(ranked[0]) / totalExposure) * 100 : 0;
  const band = bandFor(topShareRaw, hhi);
  const coveragePct = pct(committed, pipelineValue);
  const uncommitted = Math.max(0, (pipelineValue || 0) - (committed || 0));

  const headline =
    sized.length === 0
      ? 'No sized deals in the live pipeline yet'
      : band === 'Diversified'
        ? `Well spread across ${sized.length} deals — ${coveragePct}% committed`
        : `${topDeal ? topDeal.dealName : 'Top deal'} is ${topDeal?.share ?? 0}% of exposure — ${fmtUsd(uncommitted)} still to commit`;

  return {
    committed: committed || 0,
    pipelineValue: pipelineValue || 0,
    coveragePct,
    uncommitted,
    totalExposure,
    sizedDeals: sized.length,
    byStage,
    topDeal,
    top3Share,
    hhi,
    band,
    headline
  };
}
