/* ============================================================================
 * lib/intelligence/conviction.ts — the FundExecs Deal Conviction Index.
 *
 * A proprietary, deterministic "credit score for a deal": one explainable 0–100
 * number built entirely from data the OS already holds — no external APIs, no
 * model call. It compounds the rest of the platform: the diligence committee's
 * conviction (P1-C), capital coverage from allocations, formation-stage
 * progression, and momentum (recency of activity).
 *
 * Every score ships with its factor breakdown and a single next-best lever, in
 * the same evidence-backed, on-the-record spirit as the match scorer and the
 * Chain of Trust. Pure + total — trivially unit-testable.
 * ========================================================================= */

/** Canonical formation stages (mirrors pipeline STAGE_ORDER), earliest → latest. */
export const CONVICTION_STAGE_ORDER = [
  'visitor',
  'prospect',
  'qualified',
  'meeting',
  'diligence',
  'soft-circle',
  'committed',
  'closed'
] as const;

/** Allocation statuses that count as real, committed capital. */
const COMMITTED_ALLOCATION_STATUSES = new Set([
  'accepted',
  'committed',
  'closed',
  'funded',
  'wired',
  'signed'
]);

/** The minimal deal shape the index needs — a structural subset of PipelineDeal. */
export interface ConvictionInput {
  id: string;
  name: string;
  stage: string;
  amount: number | null;
  allocations: Array<{ amount: number | null; status: string }>;
  diligenceRuns: Array<{ status: string; conviction: number | null }>;
  /** ISO timestamp of last activity. */
  updatedAt: string;
}

export type ConvictionBand = 'High' | 'Building' | 'Early' | 'Cold';

export interface ConvictionFactor {
  key: 'diligence' | 'coverage' | 'stage' | 'momentum';
  label: string;
  /** Raw 0–100 strength of this factor. */
  raw: number;
  /** Factor weight (the four weights sum to 1). */
  weight: number;
  /** raw × weight, the points this factor adds to the composite. */
  contribution: number;
  /** Human-readable evidence for the raw value. */
  detail: string;
  /** What would most move this factor (the lever). */
  hint: string;
}

export interface ConvictionResult {
  dealId: string;
  dealName: string;
  /** Composite 0–100. */
  score: number;
  band: ConvictionBand;
  factors: ConvictionFactor[];
  /** The single highest-leverage next move (the weakest weighted factor). */
  topLever: string;
}

const WEIGHTS = { diligence: 0.35, coverage: 0.25, stage: 0.2, momentum: 0.2 } as const;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function bandFor(score: number): ConvictionBand {
  if (score >= 75) return 'High';
  if (score >= 50) return 'Building';
  if (score >= 25) return 'Early';
  return 'Cold';
}

/** Latest *complete* diligence conviction; falls back to any run's conviction. */
function diligenceRaw(runs: ConvictionInput['diligenceRuns']): { raw: number; detail: string } {
  const complete = runs.find((r) => r.status === 'complete' && typeof r.conviction === 'number');
  if (complete && typeof complete.conviction === 'number') {
    return { raw: clamp(complete.conviction), detail: `IC conviction ${complete.conviction}/100` };
  }
  const any = runs.find((r) => typeof r.conviction === 'number');
  if (any && typeof any.conviction === 'number') {
    return {
      raw: clamp(any.conviction) * 0.6,
      detail: `Diligence in progress (${any.conviction}/100)`
    };
  }
  return { raw: 0, detail: 'No diligence run yet' };
}

function coverageRaw(
  amount: number | null,
  allocations: ConvictionInput['allocations']
): { raw: number; detail: string } {
  const committed = allocations
    .filter((a) => COMMITTED_ALLOCATION_STATUSES.has((a.status || '').toLowerCase()))
    .reduce((sum, a) => sum + (a.amount ?? 0), 0);
  if (amount && amount > 0) {
    const pct = clamp((committed / amount) * 100);
    return {
      raw: pct,
      detail: `${fmtUsd(committed)} of ${fmtUsd(amount)} committed (${Math.round(pct)}%)`
    };
  }
  // No target set: any committed capital is a positive, unmeasured signal.
  return committed > 0
    ? { raw: 60, detail: `${fmtUsd(committed)} committed (no target set)` }
    : { raw: 0, detail: 'No committed capital yet' };
}

function stageRaw(stage: string): { raw: number; detail: string } {
  const idx = CONVICTION_STAGE_ORDER.indexOf(
    (stage || '').toLowerCase() as (typeof CONVICTION_STAGE_ORDER)[number]
  );
  if (idx < 0) return { raw: 0, detail: `Stage: ${stage || 'unknown'}` };
  const raw = (idx / (CONVICTION_STAGE_ORDER.length - 1)) * 100;
  return { raw, detail: `Stage: ${stage} (${idx + 1}/${CONVICTION_STAGE_ORDER.length})` };
}

function momentumRaw(updatedAt: string, now: number): { raw: number; detail: string } {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return { raw: 0, detail: 'No recent activity' };
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  const raw =
    days <= 7 ? 100 : days <= 14 ? 80 : days <= 30 ? 60 : days <= 60 ? 35 : days <= 90 ? 15 : 5;
  const detail = days === 0 ? 'Updated today' : `Updated ${days} day${days === 1 ? '' : 's'} ago`;
  return { raw, detail };
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

const HINTS: Record<ConvictionFactor['key'], string> = {
  diligence: 'Run the diligence committee to raise conviction',
  coverage: 'Line up committed allocations to close coverage',
  stage: 'Advance the deal to the next formation stage',
  momentum: 'Log activity — this deal is going cold'
};

/**
 * Compute the Conviction Index for a deal. `now` is injectable for tests.
 */
export function computeConviction(
  deal: ConvictionInput,
  now: number = Date.now()
): ConvictionResult {
  const dil = diligenceRaw(deal.diligenceRuns ?? []);
  const cov = coverageRaw(deal.amount, deal.allocations ?? []);
  const stg = stageRaw(deal.stage);
  const mom = momentumRaw(deal.updatedAt, now);

  const factors: ConvictionFactor[] = [
    mk('diligence', 'Diligence', dil, WEIGHTS.diligence),
    mk('coverage', 'Capital coverage', cov, WEIGHTS.coverage),
    mk('stage', 'Stage progression', stg, WEIGHTS.stage),
    mk('momentum', 'Momentum', mom, WEIGHTS.momentum)
  ];

  const score = Math.round(factors.reduce((s, f) => s + f.contribution, 0));

  // The top lever is the factor with the largest *recoverable* weighted gap.
  const lever = [...factors].sort((a, b) => (100 - b.raw) * b.weight - (100 - a.raw) * a.weight)[0];

  return {
    dealId: deal.id,
    dealName: deal.name,
    score,
    band: bandFor(score),
    factors,
    topLever: lever ? lever.hint : ''
  };
}

function mk(
  key: ConvictionFactor['key'],
  label: string,
  v: { raw: number; detail: string },
  weight: number
): ConvictionFactor {
  const raw = clamp(v.raw);
  return {
    key,
    label,
    raw: Math.round(raw),
    weight,
    contribution: raw * weight,
    detail: v.detail,
    hint: HINTS[key]
  };
}

/** Distribution of bands across a set of results, for a portfolio glance. */
export function convictionDistribution(
  results: ConvictionResult[]
): Record<ConvictionBand, number> {
  const dist: Record<ConvictionBand, number> = { High: 0, Building: 0, Early: 0, Cold: 0 };
  for (const r of results) dist[r.band] += 1;
  return dist;
}
