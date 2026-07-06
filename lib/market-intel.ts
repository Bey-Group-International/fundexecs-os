// lib/market-intel.ts
// Market Intelligence — a clean-room, PitchBook-style deal/investor intelligence
// directory. This is the PURE core: it takes already-fetched rows from four
// existing Source/Execute tables (investors, deals, funds, partners) and merges
// them into one normalized, searchable, rankable relationship-intelligence view.
//
// No React, no DB, no I/O — every function here is a deterministic transform so
// it is trivially unit-testable and can run on server or client. Persistence and
// org-scoping live in components/source/MarketIntelModule.tsx.

/** The kind of source entity a record was distilled from. */
export type IntelKind = "investor" | "deal" | "fund" | "partner";

/** Coarse activity signal, bucketed from `relevance` (see `momentumFor`). */
export type Momentum = "hot" | "warm" | "cool";

/**
 * A single normalized row in the unified directory. Every source kind is mapped
 * onto this one shape so search, filter, and ranking are kind-agnostic.
 */
export interface IntelRecord {
  id: string;
  kind: IntelKind;
  name: string;
  sector: string | null;
  geography: string | null;
  size_usd: number | null;
  stage: string | null;
  /** Composite desirability score in [0, 100]. See `computeRelevance`. */
  relevance: number;
  momentum: Momentum;
}

/** Rows grouped by source table. Each is optional and defaults to empty. */
export interface IntelSources {
  investors?: RawRow[];
  deals?: RawRow[];
  funds?: RawRow[];
  partners?: RawRow[];
}

/** A loosely-typed source row — only the columns we read are accessed. */
type RawRow = Record<string, unknown>;

export interface IntelFilters {
  kinds?: string[];
  sector?: string | null;
  momentum?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Stage progression weights in [0, 1]. Keyed by lowercased stage tokens drawn
// from DealStage (database.types), investor pipeline_stage values, and partner
// status values. Farther along the lifecycle → higher weight → more relevant.
const STAGE_PROGRESS: Record<string, number> = {
  // deal lifecycle
  sourced: 0.1,
  screening: 0.25,
  diligence: 0.5,
  underwriting: 0.6,
  ic_review: 0.7,
  closing: 0.85,
  owned: 0.95,
  exited: 1.0,
  passed: 0.05,
  dead: 0.0,
  // investor / partner pipeline-ish tokens
  new: 0.1,
  prospect: 0.15,
  prospective: 0.2,
  contacted: 0.3,
  engaged: 0.5,
  meeting: 0.55,
  negotiating: 0.7,
  committed: 0.9,
  signed: 0.9,
  closed: 1.0,
  active: 0.8,
  inactive: 0.1,
};

const MS_PER_DAY = 86_400_000;

/**
 * Relevance formula — a documented, deterministic composite in [0, 100]:
 *
 *   relevance = sizeScore(0–40) + stageScore(0–40) + recencyScore(0–20)
 *
 *  • sizeScore   — log-scaled capital footprint. $100k or less → 0, $10B+ → 40,
 *                  interpolated on log10 between 1e5 and 1e10. null/0 → 0.
 *  • stageScore  — lifecycle advancement from STAGE_PROGRESS × 40. A known,
 *                  late-stage token scores near 40; an unknown stage gets a
 *                  neutral 0.4 (16); a missing stage 0.3 (12).
 *  • recencyScore— freshness decay from `createdAt`. ≤30 days old → 20, decaying
 *                  linearly to 0 by ~1 year; missing/invalid date → neutral 10.
 *
 * The result is rounded and clamped to [0, 100].
 */
export function computeRelevance(input: {
  size_usd: number | null;
  stage: string | null;
  createdAt?: string | null;
  now?: number;
}): number {
  const { size_usd, stage } = input;

  // Size (0–40).
  let sizeScore = 0;
  if (size_usd != null && size_usd > 0) {
    const logv = Math.log10(size_usd);
    sizeScore = clamp(((logv - 5) / (10 - 5)) * 40, 0, 40);
  }

  // Stage (0–40).
  const weight =
    stage != null ? (STAGE_PROGRESS[stage.toLowerCase()] ?? 0.4) : 0.3;
  const stageScore = weight * 40;

  // Recency (0–20).
  let recencyScore = 10;
  const created = input.createdAt ? Date.parse(input.createdAt) : NaN;
  if (!Number.isNaN(created)) {
    const now = input.now ?? Date.now();
    const ageDays = (now - created) / MS_PER_DAY;
    recencyScore = ageDays <= 30 ? 20 : clamp(20 * (1 - (ageDays - 30) / 365), 0, 20);
  }

  return clamp(Math.round(sizeScore + stageScore + recencyScore), 0, 100);
}

/** Bucket a relevance score into a momentum band. */
export function momentumFor(relevance: number): Momentum {
  if (relevance >= 66) return "hot";
  if (relevance >= 33) return "warm";
  return "cool";
}

// ── Per-kind mappers ─────────────────────────────────────────────────────────

function mapInvestor(r: RawRow, now?: number): IntelRecord {
  const size_usd = num(r.aum);
  const stage = str(r.pipeline_stage);
  const relevance = computeRelevance({
    size_usd,
    stage,
    createdAt: str(r.created_at),
    now,
  });
  return {
    id: String(r.id),
    kind: "investor",
    name: str(r.name) ?? "Untitled investor",
    sector: str(r.investor_type),
    geography: str(r.jurisdiction),
    size_usd,
    stage,
    relevance,
    momentum: momentumFor(relevance),
  };
}

function mapDeal(r: RawRow, now?: number): IntelRecord {
  const size_usd = num(r.target_amount);
  const stage = str(r.stage);
  const relevance = computeRelevance({
    size_usd,
    stage,
    createdAt: str(r.created_at),
    now,
  });
  return {
    id: String(r.id),
    kind: "deal",
    name: str(r.name) ?? "Untitled deal",
    sector: str(r.asset_class),
    geography: str(r.geography),
    size_usd,
    stage,
    relevance,
    momentum: momentumFor(relevance),
  };
}

function mapFund(r: RawRow, now?: number): IntelRecord {
  const size_usd = num(r.target_size);
  const vintage = num(r.vintage_year);
  const stage = vintage != null ? `Vintage ${vintage}` : null;
  const relevance = computeRelevance({
    size_usd,
    // Fund "stage" is a display label, not a lifecycle token; pass null so it
    // takes the neutral stage weight rather than a spurious lookup.
    stage: null,
    createdAt: str(r.created_at),
    now,
  });
  return {
    id: String(r.id),
    kind: "fund",
    name: str(r.name) ?? "Untitled fund",
    sector: str(r.fund_type),
    geography: null,
    size_usd,
    stage,
    relevance,
    momentum: momentumFor(relevance),
  };
}

function mapPartner(r: RawRow, now?: number): IntelRecord {
  const stage = str(r.status);
  const relevance = computeRelevance({
    size_usd: null,
    stage,
    createdAt: str(r.created_at),
    now,
  });
  return {
    id: String(r.id),
    kind: "partner",
    name: str(r.name) ?? "Untitled partner",
    sector: str(r.partner_type),
    geography: null,
    size_usd: null,
    stage,
    relevance,
    momentum: momentumFor(relevance),
  };
}

/**
 * Merge raw rows from the four source tables into one normalized record set.
 * Missing groups are skipped; malformed rows are null-safe (every column read
 * degrades to null / a sensible default rather than throwing).
 */
export function buildIntel(
  sources: IntelSources,
  opts: { now?: number } = {},
): IntelRecord[] {
  const now = opts.now;
  const out: IntelRecord[] = [];
  for (const r of sources.investors ?? []) out.push(mapInvestor(r, now));
  for (const r of sources.deals ?? []) out.push(mapDeal(r, now));
  for (const r of sources.funds ?? []) out.push(mapFund(r, now));
  for (const r of sources.partners ?? []) out.push(mapPartner(r, now));
  return out;
}

// ── Search / filter / rank ───────────────────────────────────────────────────

/**
 * Case-insensitive substring search over name/sector/geography, plus structured
 * filters. All conditions are ANDed. An empty query matches everything; empty /
 * null filters are ignored. Pure — returns a new array, never mutates.
 */
export function searchIntel(
  records: IntelRecord[],
  query: string,
  filters: IntelFilters = {},
): IntelRecord[] {
  const q = query.trim().toLowerCase();
  const kinds =
    filters.kinds && filters.kinds.length > 0 ? new Set(filters.kinds) : null;
  const sector = filters.sector ? filters.sector.toLowerCase() : null;
  const momentum = filters.momentum || null;

  return records.filter((rec) => {
    if (kinds && !kinds.has(rec.kind)) return false;
    if (sector && (rec.sector?.toLowerCase() ?? "") !== sector) return false;
    if (momentum && rec.momentum !== momentum) return false;
    if (q) {
      const haystack = `${rec.name} ${rec.sector ?? ""} ${rec.geography ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Sort by relevance descending, stably (records with equal relevance keep their
 * original relative order). Returns a new array; the input is not mutated.
 */
export function rankIntel(records: IntelRecord[]): IntelRecord[] {
  return records
    .map((rec, i) => ({ rec, i }))
    .sort((a, b) => b.rec.relevance - a.rec.relevance || a.i - b.i)
    .map((x) => x.rec);
}

/** Distinct, sorted list of non-null sectors present in the record set. */
export function distinctSectors(records: IntelRecord[]): string[] {
  const set = new Set<string>();
  for (const r of records) if (r.sector) set.add(r.sector);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Distinct kinds present, in canonical order. */
export function distinctKinds(records: IntelRecord[]): IntelKind[] {
  const order: IntelKind[] = ["investor", "deal", "fund", "partner"];
  const present = new Set(records.map((r) => r.kind));
  return order.filter((k) => present.has(k));
}
