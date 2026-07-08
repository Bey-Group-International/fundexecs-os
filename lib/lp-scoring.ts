// lib/lp-scoring.ts
// LP-fit scoring — a transparent, explainable weighted model that scores and
// ranks limited partners / allocators by how well each fits the firm's current
// raise (its mandate), from the first-party signals the investor and org
// records already carry.
//
// This is a clean-room adaptation of the multi-dimension LP-fit rubric pattern:
// NOT a trained model, but a deterministic weighted combination of normalized
// factor sub-scores, each shaped to reflect how a placement agent actually
// prioritizes an allocator list, and each carrying a one-line rationale so an
// operator sees exactly why an LP scored the way it did. Structured to mirror
// lib/fund-scoring.ts (weights sum to 1.0; the breakdown adds up to the score).
//
// It extends the check-size / geography / type read already in
// lib/capital-map.ts (scoreThesisFit) with three richer allocator signals:
// sector alignment, emerging-manager openness, and recent allocation activity.
//
// Pure module: no React, no DB, no I/O. `factorsFromInvestor` / `lpMandateFrom`
// map DB rows onto the inputs but perform no queries themselves.

// ── Inputs ───────────────────────────────────────────────────────────────────

/** The firm's raise, i.e. what an LP is scored against. */
export interface LpMandate {
  /** Firm primary strategy, e.g. "private_equity" (organizations.primary_strategy). */
  strategy: string | null;
  /** Active thesis check band in USD. Null when unknown. */
  checkMin: number | null;
  checkMax: number | null;
  /** Active thesis target geographies (free-text region names). */
  geographies: string[];
  /** True when the firm is an emerging manager (few / no prior funds). */
  emergingManager: boolean;
}

/** The per-LP signals the model scores. */
export interface LpFactors {
  investorType: string;
  typicalCheckMin: number | null;
  typicalCheckMax: number | null;
  jurisdiction: string | null;
  sectors: string[];
  openToEmergingManagers: boolean | null;
  allocationSignal: string | null;
  pipelineStage: string | null;
}

export type LpTier = "high" | "medium" | "low";

/** One explainable line item in an LP's score breakdown. */
export interface LpScoredFactor {
  label: string;
  /** Model weight in [0,1]; the six weights sum to 1. */
  weight: number;
  /** Points this factor added to the 0–100 score (weight * subScore * 100). */
  contribution: number;
  /** Human-readable rationale for this factor's sub-score. */
  note: string;
}

export interface LpFitScore {
  score: number; // 0–100
  tier: LpTier;
  factors: LpScoredFactor[];
}

// ── Model weights ────────────────────────────────────────────────────────────
// Sum to 1.0. Check-size fit and investor type dominate (they most reliably
// separate a real allocator from a mismatch); geography and sector next; the
// emerging-manager and activity signals are secondary tie-breakers.
const WEIGHTS = {
  checkSize: 0.25,
  investorType: 0.22,
  geography: 0.18,
  sector: 0.15,
  emergingOpenness: 0.1,
  activity: 0.1,
} as const;

// ── Tier thresholds ──────────────────────────────────────────────────────────
// On the 0–100 score. Chosen so an all-unknown LP (~50) lands in "medium",
// clearly-aligned LPs reach "high", and clear mismatches fall to "low".
const TIER_HIGH = 70;
const TIER_MEDIUM = 50;

/** Neutral sub-score used when a factor's input is missing (unknown, not zero). */
const NEUTRAL = 0.5;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ── Factor sub-score curves (each returns [0,1]) ─────────────────────────────

/**
 * Investor-type fit. Institutional allocators that anchor funds score highest;
 * co-GPs / banks / lenders progressively lower; "other" lowest. Mirrors the
 * ranking in capital-map.scoreThesisFit, normalized to [0,1].
 */
const TYPE_SUBSCORE: Record<string, number> = {
  institution: 1.0,
  fund_of_funds: 1.0,
  family_office: 0.8,
  lp: 0.72,
  co_gp: 0.48,
  bank: 0.4,
  lender: 0.32,
  other: 0.2,
};
function investorTypeSubScore(type: string): number {
  return TYPE_SUBSCORE[type] ?? 0.3;
}

/**
 * Check-size overlap. Full credit when the investor's typical band overlaps the
 * mandate band; half credit for a near-miss (within ~2x of the near edge); low
 * otherwise. No investor band → neutral (unknown). No mandate band → treated as
 * unconstrained, so any known investor overlaps.
 */
export function checkSizeSubScore(
  invMin: number | null,
  invMax: number | null,
  thMin: number | null,
  thMax: number | null,
): number {
  if (invMin == null && invMax == null) return NEUTRAL;
  const lo = invMin ?? 0;
  const hi = invMax ?? Number.POSITIVE_INFINITY;
  const tLo = thMin ?? 0;
  const tHi = thMax ?? Number.POSITIVE_INFINITY;

  if (hi >= tLo && lo <= tHi) return 1; // bands overlap
  if (hi < tLo) return hi >= tLo / 2 ? 0.5 : 0.15; // investor writes too small
  return Number.isFinite(tHi) && lo <= tHi * 2 ? 0.5 : 0.15; // investor writes too big
}

/**
 * Geography fit. No mandate geographies → neutral (unconstrained). Investor
 * jurisdiction named in (or containing) a target geography → full; a known but
 * non-matching jurisdiction → low; unknown jurisdiction → slightly below neutral.
 */
function geographySubScore(jurisdiction: string | null, geographies: string[]): number {
  if (!geographies.length) return NEUTRAL;
  if (!jurisdiction) return 0.4;
  const j = jurisdiction.toLowerCase();
  const match = geographies.some(
    (g) => g.toLowerCase().includes(j) || j.includes(g.toLowerCase()),
  );
  return match ? 1 : 0.2;
}

/**
 * Sector / strategy alignment. Unknown investor sectors or unknown firm strategy
 * → neutral (prompts enrichment rather than penalizing). A sector that matches
 * the firm strategy → full; a known but non-matching focus → below neutral.
 */
function sectorSubScore(sectors: string[], strategy: string | null): number {
  if (!sectors.length || !strategy) return NEUTRAL;
  const strat = strategy.toLowerCase().replace(/_/g, " ");
  const match = sectors.some((s) => {
    const sec = s.toLowerCase().replace(/_/g, " ");
    return sec.includes(strat) || strat.includes(sec);
  });
  return match ? 1 : 0.3;
}

/**
 * Emerging-manager openness. Only material when the firm is itself an emerging
 * manager: then an LP known to back first-time managers scores full, one known
 * not to scores very low, unknown sits below neutral. For an established firm
 * the factor is not relevant → neutral.
 */
function emergingOpennessSubScore(
  open: boolean | null,
  emergingManager: boolean,
): number {
  if (!emergingManager) return NEUTRAL;
  if (open === true) return 1;
  if (open === false) return 0.1;
  return 0.4;
}

const ACTIVITY_RE =
  /(allocat|seeking|launch|increas|deploy|actively|committing|ramp|new mandate|open to)/i;
const STAGE_PROGRESS_RE =
  /(soft.?circle|diligence|meeting|term|negotiat|active|warm|intro|engaged|contacted|replied)/i;

/**
 * Recent allocation activity. A positive keyword in the allocation-signal note
 * → full; otherwise a pipeline stage that shows real engagement → partial; no
 * signal at all → low.
 */
function activitySubScore(
  allocationSignal: string | null,
  pipelineStage: string | null,
): number {
  if (allocationSignal && ACTIVITY_RE.test(allocationSignal)) return 1;
  if (pipelineStage && STAGE_PROGRESS_RE.test(pipelineStage)) return 0.6;
  return 0.3;
}

function tierFor(score: number): LpTier {
  if (score >= TIER_HIGH) return "high";
  if (score >= TIER_MEDIUM) return "medium";
  return "low";
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score a single LP against the mandate. Returns a 0–100 score, a tier, and the
 * explainable factor breakdown. The score is the sum of factor contributions
 * (each weight * subScore * 100), so the breakdown adds up to the score before
 * the [0,100] clamp.
 */
export function scoreLpFit(mandate: LpMandate, f: LpFactors): LpFitScore {
  const humanType = f.investorType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const checkSub = checkSizeSubScore(
    f.typicalCheckMin,
    f.typicalCheckMax,
    mandate.checkMin,
    mandate.checkMax,
  );
  const geoSub = geographySubScore(f.jurisdiction, mandate.geographies);
  const sectorSub = sectorSubScore(f.sectors, mandate.strategy);
  const emergingSub = emergingOpennessSubScore(f.openToEmergingManagers, mandate.emergingManager);
  const activitySub = activitySubScore(f.allocationSignal, f.pipelineStage);

  const parts: Array<{ label: string; weight: number; sub: number; note: string }> = [
    {
      label: "Check-size fit",
      weight: WEIGHTS.checkSize,
      sub: checkSub,
      note:
        f.typicalCheckMin == null && f.typicalCheckMax == null
          ? "Typical check unknown — neutral"
          : checkSub >= 1
            ? "Typical check overlaps the mandate band"
            : checkSub >= 0.5
              ? "Typical check is near the mandate band"
              : "Typical check sits outside the mandate band",
    },
    {
      label: "Investor type",
      weight: WEIGHTS.investorType,
      sub: investorTypeSubScore(f.investorType),
      note: `${humanType} — ${investorTypeSubScore(f.investorType) >= 0.7 ? "a strong anchor for this raise" : investorTypeSubScore(f.investorType) >= 0.4 ? "a plausible allocator" : "a weaker fit for a fund raise"}`,
    },
    {
      label: "Geography",
      weight: WEIGHTS.geography,
      sub: geoSub,
      note: !mandate.geographies.length
        ? "No geography mandate — neutral"
        : !f.jurisdiction
          ? "Investor jurisdiction unknown"
          : geoSub >= 1
            ? `Based in a target geography (${f.jurisdiction})`
            : `Outside the target geographies (${f.jurisdiction})`,
    },
    {
      label: "Sector alignment",
      weight: WEIGHTS.sector,
      sub: sectorSub,
      note:
        !f.sectors.length || !mandate.strategy
          ? "Sector focus unknown — add sectors to sharpen this"
          : sectorSub >= 1
            ? "Sector focus matches the firm strategy"
            : "Sector focus differs from the firm strategy",
    },
    {
      label: "Emerging-manager openness",
      weight: WEIGHTS.emergingOpenness,
      sub: emergingSub,
      note: !mandate.emergingManager
        ? "Established firm — not a factor"
        : f.openToEmergingManagers === true
          ? "Backs emerging managers"
          : f.openToEmergingManagers === false
            ? "Does not back emerging managers"
            : "Emerging-manager openness unknown",
    },
    {
      label: "Recent activity",
      weight: WEIGHTS.activity,
      sub: activitySub,
      note:
        activitySub >= 1
          ? "Active allocation signal on record"
          : activitySub >= 0.6
            ? "Engaged in the pipeline"
            : "No recent allocation signal",
    },
  ];

  const factors: LpScoredFactor[] = parts.map((p) => ({
    label: p.label,
    weight: p.weight,
    contribution: p.weight * p.sub * 100,
    note: p.note,
  }));

  const raw = factors.reduce((sum, x) => sum + x.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return { score, tier: tierFor(score), factors };
}

/** An LP plus its computed score, as returned by rankLps. */
export type RankedLp = {
  id: string;
  name: string;
} & LpFitScore;

/**
 * Score every LP and return them sorted by descending score (ties broken by
 * name for a stable, deterministic order).
 */
export function rankLps(
  list: Array<{ id: string; name: string; mandate: LpMandate; factors: LpFactors }>,
): RankedLp[] {
  return list
    .map((l) => ({ id: l.id, name: l.name, ...scoreLpFit(l.mandate, l.factors) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// ── DB-row mapping ───────────────────────────────────────────────────────────

/** The investor columns this mapper reads (subset of lib/supabase Investor). */
export interface InvestorRowLike {
  investor_type: string;
  typical_check_min: number | null;
  typical_check_max: number | null;
  jurisdiction: string | null;
  sectors?: string[] | null;
  open_to_emerging_managers?: boolean | null;
  allocation_signal?: string | null;
  pipeline_stage?: string | null;
}

/** The organization columns this mapper reads. */
export interface OrgMandateLike {
  primary_strategy: string | null;
  fund_count: number | null;
}

/** The active-thesis columns this mapper reads. */
export interface ThesisBandLike {
  check_size_min: number | null;
  check_size_max: number | null;
  geographies: string[];
}

/** Map an investor row onto the scorer's LpFactors. Null-safe throughout. */
export function factorsFromInvestor(row: InvestorRowLike): LpFactors {
  return {
    investorType: row.investor_type,
    typicalCheckMin: row.typical_check_min,
    typicalCheckMax: row.typical_check_max,
    jurisdiction: row.jurisdiction,
    sectors: row.sectors ?? [],
    openToEmergingManagers: row.open_to_emerging_managers ?? null,
    allocationSignal: row.allocation_signal ?? null,
    pipelineStage: row.pipeline_stage ?? null,
  };
}

/**
 * Build the LpMandate from the org profile and its active thesis. A firm with
 * one or zero prior funds is treated as an emerging manager.
 */
export function lpMandateFrom(
  org: OrgMandateLike,
  thesis: ThesisBandLike | null,
): LpMandate {
  return {
    strategy: org.primary_strategy,
    checkMin: thesis?.check_size_min ?? null,
    checkMax: thesis?.check_size_max ?? null,
    geographies: thesis?.geographies ?? [],
    emergingManager: (org.fund_count ?? 0) <= 1,
  };
}
