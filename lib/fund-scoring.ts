// lib/fund-scoring.ts
// ML-style fund-selection scoring — a transparent, fully-documented weighted
// model that scores and ranks a firm's funds by predicted relative performance
// from pre-investment ("ex ante") factors, with an explainable factor
// breakdown.
//
// This is NOT a trained model. It is a deterministic, hand-tuned weighted
// combination of normalized factor sub-scores, each shaped by a logistic /
// bell curve chosen to reflect the direction and shape reported in the PE
// fund-selection literature (performance persistence, GP experience,
// specialization premium, fund-size diseconomies of scale). Every weight,
// threshold, and curve constant carries a one-line rationale so an operator
// can see exactly why a fund scored the way it did.
//
// Pure module: no React, no DB, no I/O. `factorsFromFund` maps DB rows onto the
// factor inputs but performs no queries itself.

/** Ex-ante inputs the model scores a single fund on. */
export interface FundFactors {
  /** Fund size in USD (target or committed). Null when unknown. */
  fund_size_usd: number | null;
  /** Vintage year (kept for context / display; not scored directly). */
  vintage_year: number | null;
  /** Count of prior funds the GP has raised — a persistence / experience proxy. */
  gp_experience_funds: number;
  /** Whether the strategy is sector/asset-class specialized (vs. generalist). */
  sector_specialized: boolean;
  /** Prior realized gross IRR as a fraction (0.15 = 15%). Null = no track record. */
  prior_gross_irr: number | null;
  /** Prior gross MOIC (multiple, e.g. 2.1). Null = no track record. */
  prior_moic: number | null;
  /** Deployment discipline: called / committed, ~0..1+. Null when unknown. */
  committed_ratio: number | null;
}

export type FundTier = "top" | "upper" | "mid" | "lower";

/** One explainable line item in a fund's score breakdown. */
export interface ScoredFactor {
  label: string;
  /** Model weight in [0,1]; the six weights sum to 1. */
  weight: number;
  /** Points this factor added to the 0–100 score (weight * subScore * 100). */
  contribution: number;
  /** Human-readable rationale for this factor's sub-score. */
  note: string;
}

export interface FundScore {
  score: number; // 0–100
  tier: FundTier;
  factors: ScoredFactor[];
}

// ── Model weights ────────────────────────────────────────────────────────────
// Sum to 1.0. Ordering reflects predictive weight reported in PE selection
// literature: prior performance persistence dominates, GP experience next, then
// fund-size scale effects and the specialization premium.
const WEIGHTS = {
  // Performance persistence is the single strongest documented ex-ante signal
  // in private equity — prior-fund IRR predicts next-fund IRR.
  priorIrr: 0.25,
  // GP experience: more prior funds → institutional process, deal access,
  // survivorship. Strong but with diminishing returns.
  gpExperience: 0.22,
  // Fund-size sweet spot: diseconomies of scale hurt mega-funds; sub-scale
  // funds lack resources. A mid-size curve captures this.
  fundSize: 0.18,
  // Specialization premium: focused sector funds outperform generalists on
  // average (information edge), a repeatedly documented effect.
  specialization: 0.15,
  // MOIC persistence corroborates IRR persistence but is duration-insensitive,
  // so it is weighted below IRR.
  priorMoic: 0.12,
  // Deployment discipline: pacing that is neither undeployed (unproven) nor
  // over-called (stretched) — a mild secondary signal.
  deployment: 0.08,
} as const;

// ── Tier thresholds ──────────────────────────────────────────────────────────
// Documented cutoffs on the 0–100 score. Chosen so an all-neutral fund (~50)
// lands in "mid", clearly-above-benchmark funds reach "upper"/"top", and
// clearly-below funds fall to "lower".
const TIER_TOP = 75; // >=75: high-conviction, top-quartile-style profile
const TIER_UPPER = 60; // >=60: above-benchmark
const TIER_MID = 40; // >=40: around benchmark; below this is "lower"

/** Neutral sub-score used when a factor's input is missing (unproven, not zero). */
const NEUTRAL = 0.5;
/**
 * Sub-score for a missing track record. Slightly below neutral: an unproven GP
 * carries more uncertainty than a benchmark-average one, but is not penalized as
 * a poor performer.
 */
const UNPROVEN = 0.4;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Standard logistic squashing. */
function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ── Factor sub-score curves (each returns [0,1]) ─────────────────────────────

/**
 * Fund-size sweet-spot bell curve. Peaks near the ~$500M mid-market sweet spot
 * (log10 ≈ 8.7) and decays for both sub-scale and mega funds, encoding the
 * diseconomies-of-scale finding. Sigma ≈ 0.9 decades gives a broad, forgiving
 * curve. Missing/zero size → neutral.
 */
function fundSizeSubScore(sizeUsd: number | null): number {
  if (sizeUsd == null || sizeUsd <= 0) return NEUTRAL;
  const sweetSpotLog = Math.log10(500_000_000); // ~8.70
  const sigma = 0.9; // decades of tolerance before the score falls off
  const d = (Math.log10(sizeUsd) - sweetSpotLog) / sigma;
  return clamp01(Math.exp(-(d * d) / 2));
}

/**
 * GP experience persistence with diminishing returns. Floor of 0.15 for a
 * first-time GP (0 prior funds — not disqualifying but unproven), rising toward
 * ~1.0 via funds/(funds+3): ~0.575 at 3 prior funds, ~0.79 at 9.
 */
function gpExperienceSubScore(priorFunds: number): number {
  const n = Math.max(0, priorFunds);
  return clamp01(0.15 + 0.85 * (n / (n + 3)));
}

/**
 * Specialization premium — a step: specialized strategies price in an
 * information edge (0.85), generalists sit below neutral (0.45).
 */
function specializationSubScore(specialized: boolean): number {
  return specialized ? 0.85 : 0.45;
}

/**
 * Prior gross IRR persistence. Logistic centered on a 15% benchmark (0.15 → 0.5)
 * with slope 12, so ~25% IRR ≈ 0.77 and ~5% ≈ 0.23. Monotonically increasing in
 * IRR. Missing track record → UNPROVEN.
 */
function priorIrrSubScore(irr: number | null): number {
  if (irr == null) return UNPROVEN;
  return clamp01(logistic(12 * (irr - 0.15)));
}

/**
 * Prior MOIC persistence. Logistic centered on 1.8x (0.5) with slope 1.2, so
 * ~2.5x ≈ 0.70 and ~1.0x ≈ 0.29. Missing → UNPROVEN.
 */
function priorMoicSubScore(moic: number | null): number {
  if (moic == null) return UNPROVEN;
  return clamp01(logistic(1.2 * (moic - 1.8)));
}

/**
 * Deployment discipline. Triangular preference peaking at 60% called (steady
 * pacing): fully-undeployed and over-called both score lower. Missing → neutral.
 */
function deploymentSubScore(ratio: number | null): number {
  if (ratio == null) return NEUTRAL;
  const peak = 0.6; // preferred called/committed ratio
  return clamp01(1 - Math.min(1, Math.abs(ratio - peak) / 0.8));
}

function tierFor(score: number): FundTier {
  if (score >= TIER_TOP) return "top";
  if (score >= TIER_UPPER) return "upper";
  if (score >= TIER_MID) return "mid";
  return "lower";
}

/**
 * Score a single fund. Returns a 0–100 score, a tier, and the explainable
 * factor breakdown. The score is the sum of factor contributions (each
 * weight * subScore * 100), so the breakdown always adds up to the score
 * (before the [0,100] clamp). Each sub-score is itself a logistic/bell curve —
 * a "weighted logistic-ish combination of normalized factor sub-scores".
 */
export function scoreFund(f: FundFactors): FundScore {
  const parts: Array<{
    label: string;
    weight: number;
    sub: number;
    note: string;
  }> = [
    {
      label: "Prior gross IRR",
      weight: WEIGHTS.priorIrr,
      sub: priorIrrSubScore(f.prior_gross_irr),
      note:
        f.prior_gross_irr == null
          ? "No prior track record — scored as unproven"
          : `Prior gross IRR ${(f.prior_gross_irr * 100).toFixed(1)}% vs. 15% benchmark`,
    },
    {
      label: "GP experience",
      weight: WEIGHTS.gpExperience,
      sub: gpExperienceSubScore(f.gp_experience_funds),
      note:
        f.gp_experience_funds <= 0
          ? "First-time GP — no prior funds"
          : `${f.gp_experience_funds} prior fund${f.gp_experience_funds === 1 ? "" : "s"} (diminishing returns)`,
    },
    {
      label: "Fund size",
      weight: WEIGHTS.fundSize,
      sub: fundSizeSubScore(f.fund_size_usd),
      note:
        f.fund_size_usd == null || f.fund_size_usd <= 0
          ? "Fund size unknown — neutral"
          : `${formatUsdShort(f.fund_size_usd)} vs. ~$500M sweet spot`,
    },
    {
      label: "Specialization",
      weight: WEIGHTS.specialization,
      sub: specializationSubScore(f.sector_specialized),
      note: f.sector_specialized
        ? "Sector-specialized — information-edge premium"
        : "Generalist strategy — no specialization premium",
    },
    {
      label: "Prior MOIC",
      weight: WEIGHTS.priorMoic,
      sub: priorMoicSubScore(f.prior_moic),
      note:
        f.prior_moic == null
          ? "No prior track record — scored as unproven"
          : `Prior MOIC ${f.prior_moic.toFixed(2)}x vs. 1.8x benchmark`,
    },
    {
      label: "Deployment discipline",
      weight: WEIGHTS.deployment,
      sub: deploymentSubScore(f.committed_ratio),
      note:
        f.committed_ratio == null
          ? "Deployment pace unknown — neutral"
          : `${(f.committed_ratio * 100).toFixed(0)}% called vs. ~60% preferred pace`,
    },
  ];

  const factors: ScoredFactor[] = parts.map((p) => ({
    label: p.label,
    weight: p.weight,
    contribution: p.weight * p.sub * 100,
    note: p.note,
  }));

  const raw = factors.reduce((sum, x) => sum + x.contribution, 0);
  const score = Math.max(0, Math.min(100, raw));

  return { score, tier: tierFor(score), factors };
}

/**
 * A fund plus its computed score, as returned by rankFunds. `factors` is the
 * scored breakdown (from FundScore); the raw ex-ante inputs are preserved under
 * `inputs` so the UI can still show the underlying metrics.
 */
export type RankedFund = {
  id: string;
  name: string;
  inputs: FundFactors;
} & FundScore;

/**
 * Score every fund and return them sorted by descending score (ties broken by
 * name for a stable, deterministic order).
 */
export function rankFunds(
  list: Array<{ id: string; name: string; factors: FundFactors }>,
): RankedFund[] {
  return list
    .map((f) => ({ id: f.id, name: f.name, inputs: f.factors, ...scoreFund(f.factors) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// ── DB-row mapping ───────────────────────────────────────────────────────────

/** The Fund columns this mapper reads (subset of lib/supabase Fund). */
export interface FundRowLike {
  id: string;
  name: string;
  fund_type?: string | null;
  vintage_year: number | null;
  target_size: number | null;
  committed_capital: number;
  called_capital: number;
  distributed_capital: number;
}

/** The TrackRecord columns this mapper reads (subset of lib/supabase TrackRecord). */
export interface TrackRecordRowLike {
  asset_class: string | null;
  vintage_year: number | null;
  gross_irr: number | null;
  gross_moic: number | null;
  is_realized: boolean;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatUsdShort(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${Math.round(v / 1_000_000)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

/**
 * Map a Fund row plus the firm's prior TrackRecord rows onto FundFactors.
 * Null-safe throughout: an empty track record yields an unproven-but-scoreable
 * fund (no priors, generalist, neutral deployment) rather than throwing.
 *
 * Derivations:
 *  - fund_size_usd:      target_size, else committed_capital, else null.
 *  - gp_experience_funds: count of distinct prior vintage years in the track
 *                         record (a proxy for prior funds raised).
 *  - sector_specialized:  true when every track record shares one asset_class.
 *  - prior_gross_irr:     mean gross_irr across realized records (else all).
 *  - prior_moic:          mean gross_moic across records that report one.
 *  - committed_ratio:     called_capital / committed_capital when committed > 0.
 */
export function factorsFromFund(
  fund: FundRowLike,
  priorTrackRecords: TrackRecordRowLike[],
): FundFactors {
  const records = priorTrackRecords ?? [];

  const distinctVintages = new Set(
    records.map((r) => r.vintage_year).filter((y): y is number => y != null),
  );

  const assetClasses = new Set(
    records
      .map((r) => r.asset_class)
      .filter((c): c is string => c != null && c.trim() !== ""),
  );

  const realized = records.filter((r) => r.is_realized);
  const irrPool = (realized.length > 0 ? realized : records)
    .map((r) => r.gross_irr)
    .filter((x): x is number => x != null);
  const moicPool = records
    .map((r) => r.gross_moic)
    .filter((x): x is number => x != null);

  const committed = fund.committed_capital ?? 0;
  const committedRatio =
    committed > 0 ? (fund.called_capital ?? 0) / committed : null;

  return {
    fund_size_usd: fund.target_size ?? (committed > 0 ? committed : null),
    vintage_year: fund.vintage_year,
    gp_experience_funds: distinctVintages.size,
    sector_specialized: assetClasses.size === 1,
    prior_gross_irr: average(irrPool),
    prior_moic: average(moicPool),
    committed_ratio: committedRatio,
  };
}
