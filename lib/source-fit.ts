// lib/source-fit.ts
// Deterministic mandate fit for sourced candidates.
//
// The model returns a fitScore, but that number is unexplainable and it drifts:
// the same candidate against the same mandate can come back 72 one run and 84
// the next, and nothing tells the operator which part of the mandate it
// actually satisfies. This module computes fit from the mandate overlap itself
// — geography, asset class, check size — so the ranking is reproducible and
// every point of it can be pointed at.
//
// Related but distinct from lib/capital-map.ts `scoreThesisFit`, which scores a
// PERSISTED investor row (numeric `typical_check_min`, a `jurisdiction` column)
// against a stored thesis. Sourced candidates haven't been persisted yet and
// carry free text — "$1M–$5M", "Austin, TX" — so the work here is parsing those
// into comparable values first. The scoring philosophy is deliberately the
// same: check-size overlap weighted highest, then geography, then strategy.
//
// The deterministic score does not replace the model's. It's blended in
// proportion to how much of the mandate could actually be assessed: when a
// candidate carries no ticket range, no geography and no strategies, there is
// nothing to check and the model's judgement stands unmodified. Coverage is
// what keeps this from turning "we know nothing" into a confident low score.
import type { SourceCandidate, SourcingMandate } from "@/lib/source-ai";

export type FitSignalId = "check_size" | "geography" | "asset_class";

export interface FitSignal {
  id: FitSignalId;
  label: string;
  /** true = matched, false = contradicted, null = couldn't be assessed. */
  matched: boolean | null;
  /** Share of the deterministic score this signal can contribute. */
  weight: number;
  detail?: string;
}

export interface MandateFit {
  /** 0–100 from mandate overlap alone, normalized over assessable signals. */
  score: number;
  /** 0–1 — how much of the mandate this candidate could be checked against. */
  coverage: number;
  signals: FitSignal[];
}

// Check size is the hardest constraint in private markets — an allocator who
// can't write the check is not a lead, whatever else matches. Geography is next
// because it gates the relationship. Strategy is softest: labels vary.
const WEIGHTS: Record<FitSignalId, number> = {
  check_size: 0.45,
  geography: 0.3,
  asset_class: 0.25,
};

// ---------------------------------------------------------------------------
// Money parsing
// ---------------------------------------------------------------------------

const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3,
  m: 1e6, mm: 1e6, million: 1e6, millions: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9, billions: 1e9,
  t: 1e12, trillion: 1e12,
};

/**
 * Parse a single money token: "$1.5M", "500k", "2 billion", "1,000,000".
 * Returns null when there's no number in it.
 */
export function parseMoney(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/[$£€,\s]+/g, (m) => (m.includes(" ") ? " " : ""));
  const match = s.match(/(-?\d+(?:\.\d+)?)\s*([a-z]*)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = match[2]?.trim() ?? "";
  const multiplier = suffix ? MULTIPLIERS[suffix] : 1;
  if (suffix && multiplier === undefined) return value; // unknown unit: take the bare number
  return value * (multiplier ?? 1);
}

export interface AmountRange {
  min: number;
  max: number;
}

/**
 * Parse a free-text money range into a numeric interval.
 *
 * Handles the shapes a model actually emits: "$1M–$5M", "$500K to $2M",
 * "under $20M", "$5M+", and a bare "$5M" (treated as a point estimate).
 * Returns null when no number can be found at all.
 */
export function parseAmountRange(raw: unknown): AmountRange | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const openEndedUp = /\b(under|below|less than|up to|max|maximum|sub)\b|^</.test(s);
  const openEndedDown = /\b(over|above|more than|at least|min|minimum|from)\b|\+\s*$|^>/.test(s);

  // Split on a range separator, but not on a hyphen inside a number — and not
  // inside a word: without the boundaries, the "and" in "thousand" splits
  // "500 thousand" into "500 thous" and the value comes back 1000x too small.
  const parts = s
    .split(/\s*(?:–|—|-{1,2}|\bto\b|\bthrough\b|\band\b|\.\.\.?)\s*/)
    .map((p) => p.trim())
    .filter((p) => /\d/.test(p));

  if (parts.length === 0) return null;

  if (parts.length === 1) {
    const value = parseMoney(parts[0]);
    if (value === null) return null;
    if (openEndedUp) return { min: 0, max: value };
    if (openEndedDown) return { min: value, max: Number.POSITIVE_INFINITY };
    return { min: value, max: value };
  }

  const first = parseMoney(parts[0]);
  const second = parseMoney(parts[parts.length - 1]);
  if (first === null || second === null) return null;
  // "$1–5M": the unit lives on the second token, so a bare first number that is
  // orders of magnitude smaller inherits it.
  const firstHasUnit = /\d\s*(k|m|mm|b|bn|t|thousand|million|billion|trillion)/.test(parts[0]);
  const scaled = !firstHasUnit && second > first && second / first >= 1000
    ? inheritUnit(first, second)
    : first;
  return { min: Math.min(scaled, second), max: Math.max(scaled, second) };
}

/** Give a bare leading number the unit of the trailing one: "1–5M" → 1M–5M. */
function inheritUnit(bare: number, withUnit: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(withUnit) / 3) * 3);
  return bare * magnitude;
}

/** Two closed intervals overlap when neither ends before the other begins. */
export function rangesOverlap(a: AmountRange, b: AmountRange): boolean {
  return a.min <= b.max && b.min <= a.max;
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

const US_STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms",
  missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv",
  "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi",
  wyoming: "wy", "district of columbia": "dc",
};

// US regions as an operator uses them. Heuristic by nature — regional
// boundaries are contested — but far better than substring matching, which
// can't see that a fund in Atlanta is in the Southeast.
const US_REGIONS: Record<string, string[]> = {
  northeast: ["me", "nh", "vt", "ma", "ri", "ct", "ny", "nj", "pa"],
  "new england": ["me", "nh", "vt", "ma", "ri", "ct"],
  "mid atlantic": ["ny", "nj", "pa", "de", "md", "dc", "va", "wv"],
  southeast: ["de", "md", "dc", "va", "wv", "nc", "sc", "ga", "fl", "ky", "tn", "al", "ms", "ar", "la"],
  south: ["tx", "ok", "ar", "la", "ms", "al", "tn", "ky", "ga", "fl", "sc", "nc", "va", "wv"],
  midwest: ["oh", "in", "il", "mi", "wi", "mn", "ia", "mo", "nd", "sd", "ne", "ks"],
  southwest: ["tx", "ok", "nm", "az"],
  west: ["co", "wy", "mt", "id", "ut", "nv", "ca", "or", "wa", "ak", "hi"],
  "west coast": ["ca", "or", "wa"],
  "pacific northwest": ["wa", "or", "id"],
  mountain: ["co", "wy", "mt", "id", "ut", "nv"],
  rockies: ["co", "wy", "mt", "id", "ut"],
  "sun belt": ["al", "az", "ar", "ca", "fl", "ga", "la", "ms", "nm", "nv", "nc", "ok", "sc", "tn", "tx", "ut"],
  "gulf coast": ["tx", "la", "ms", "al", "fl"],
};

// Terms that mean "anywhere in the US" — they match any US state or region.
const US_WIDE = new Set(["us", "usa", "u s", "united states", "united states of america", "america", "north america", "domestic", "nationwide"]);

// Two-letter state codes that are also ordinary words or common place-name
// particles. "Rio de Janeiro" is not Delaware and "La Jolla" is not Louisiana,
// so these are only read as states when written as a code (uppercase in the
// original text) or when they are the entire term.
const AMBIGUOUS_STATE_CODES = new Set([
  "de", "la", "in", "or", "me", "hi", "pa", "ok", "oh", "id",
  "ma", "co", "ne", "mi", "mt", "mo", "ms", "ct", "al", "ar",
]);

/** Whole-word phrase test without building a regex per call. */
function hasPhrase(haystack: string, phrase: string): boolean {
  if (haystack === phrase) return true;
  return (
    haystack.startsWith(`${phrase} `) ||
    haystack.endsWith(` ${phrase}`) ||
    haystack.includes(` ${phrase} `)
  );
}

function normalizeGeoText(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every US state code a geography term implies (state, region, or country-wide). */
function statesImplied(term: string): Set<string> {
  const t = normalizeGeoText(term);
  const out = new Set<string>();
  if (!t) return out;
  if (US_WIDE.has(t)) {
    Object.values(US_STATES).forEach((code) => out.add(code));
    return out;
  }
  for (const [name, code] of Object.entries(US_STATES)) {
    if (hasPhrase(t, name)) out.add(code);
  }
  for (const code of Object.values(US_STATES)) {
    if (!hasPhrase(t, code)) continue;
    // An ambiguous code counts only when the source actually wrote it as a
    // code — uppercase in the raw text — or when it is the whole term.
    if (AMBIGUOUS_STATE_CODES.has(code) && t !== code && !hasPhrase(term, code.toUpperCase())) {
      continue;
    }
    out.add(code);
  }
  for (const [region, codes] of Object.entries(US_REGIONS)) {
    if (hasPhrase(t, region)) codes.forEach((c) => out.add(c));
  }
  return out;
}

/**
 * True when a candidate's location falls inside any mandate geography.
 *
 * Resolves each side to US state codes where it can — so "Southeast" matches
 * "Atlanta, GA", and "Texas" matches "Austin, TX" — and falls back to token
 * containment for everything else ("London" vs "London, UK").
 */
export function geographyMatches(candidateGeo: string, mandateGeographies: string[]): boolean {
  const cand = normalizeGeoText(candidateGeo);
  if (!cand || !mandateGeographies.length) return false;

  const candStates = statesImplied(candidateGeo);
  for (const target of mandateGeographies) {
    const t = normalizeGeoText(target);
    if (!t) continue;
    if (t === cand) return true;

    const targetStates = statesImplied(target);
    if (candStates.size && targetStates.size) {
      for (const code of candStates) if (targetStates.has(code)) return true;
    }

    // Token containment for anything the state map can't resolve.
    const candTokens = cand.split(" ").filter(Boolean);
    const targetTokens = t.split(" ").filter(Boolean);
    if (targetTokens.length && targetTokens.every((tok) => candTokens.includes(tok))) return true;
    if (candTokens.length && candTokens.every((tok) => targetTokens.includes(tok))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Asset class / strategy
// ---------------------------------------------------------------------------

/** Normalize a strategy label to comparable tokens ("Industrials" → ["industrial"]). */
function strategyTokens(v: string): string[] {
  return normalizeGeoText(v)
    .split(" ")
    .filter(Boolean)
    .map((t) => t.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, ""))
    .filter((t) => t.length > 2 && !STOP_TERMS.has(t));
}

// Words that appear in almost every strategy label and so carry no signal.
const STOP_TERMS = new Set(["the", "and", "for", "with", "fund", "funds", "capital", "investment", "strategy", "focused", "focu"]);

/**
 * True when any mandate asset class shares meaningful terms with the
 * candidate's category or stated strategies — "industrials" vs "industrial",
 * "real estate" vs "value-add real estate".
 */
export function assetClassMatches(candidateTerms: string[], mandateClasses: string[]): boolean {
  const candidate = new Set(candidateTerms.flatMap(strategyTokens));
  if (!candidate.size) return false;
  return mandateClasses.some((cls) => {
    const wanted = strategyTokens(cls);
    return wanted.length > 0 && wanted.some((t) => candidate.has(t));
  });
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score one candidate against the mandate from the signals both sides carry.
 *
 * A signal is only assessed when BOTH the mandate states a constraint and the
 * candidate carries the field. Everything else is `matched: null` and drops out
 * of both the score and the coverage, so an unstated mandate never penalizes a
 * candidate and a sparse candidate never scores a confident zero.
 */
export function computeMandateFit(candidate: SourceCandidate, mandate: SourcingMandate | null): MandateFit {
  const signals: FitSignal[] = [];

  // --- check size ---------------------------------------------------------
  const mandateBand: AmountRange | null =
    mandate && (mandate.checkSizeMin != null || mandate.checkSizeMax != null)
      ? { min: mandate.checkSizeMin ?? 0, max: mandate.checkSizeMax ?? Number.POSITIVE_INFINITY }
      : null;
  const candidateBand = parseAmountRange(candidate.ticketRange);
  if (mandateBand && candidateBand) {
    const overlaps = rangesOverlap(candidateBand, mandateBand);
    signals.push({
      id: "check_size",
      label: "Check size",
      matched: overlaps,
      weight: WEIGHTS.check_size,
      detail: overlaps
        ? `Ticket ${candidate.ticketRange} overlaps the mandate band.`
        : `Ticket ${candidate.ticketRange} sits outside the mandate band.`,
    });
  } else {
    signals.push({
      id: "check_size",
      label: "Check size",
      matched: null,
      weight: WEIGHTS.check_size,
      detail: mandateBand ? "No ticket range stated." : "Mandate states no check band.",
    });
  }

  // --- geography ----------------------------------------------------------
  const geographies = mandate?.geographies ?? [];
  if (geographies.length && candidate.geography) {
    const matched = geographyMatches(candidate.geography, geographies);
    signals.push({
      id: "geography",
      label: "Geography",
      matched,
      weight: WEIGHTS.geography,
      detail: matched
        ? `${candidate.geography} is in a target geography.`
        : `${candidate.geography} is outside the target geographies.`,
    });
  } else {
    signals.push({
      id: "geography",
      label: "Geography",
      matched: null,
      weight: WEIGHTS.geography,
      detail: geographies.length ? "No location stated." : "Mandate states no geography.",
    });
  }

  // --- asset class --------------------------------------------------------
  const assetClasses = mandate?.assetClasses ?? [];
  const candidateTerms = [candidate.category, ...(candidate.strategies ?? [])].filter(
    (t): t is string => Boolean(t && t.trim()),
  );
  if (assetClasses.length && candidateTerms.length) {
    const matched = assetClassMatches(candidateTerms, assetClasses);
    signals.push({
      id: "asset_class",
      label: "Strategy",
      matched,
      weight: WEIGHTS.asset_class,
      detail: matched
        ? "Strategy overlaps the mandate's asset classes."
        : "Strategy does not overlap the mandate's asset classes.",
    });
  } else {
    signals.push({
      id: "asset_class",
      label: "Strategy",
      matched: null,
      weight: WEIGHTS.asset_class,
      detail: assetClasses.length ? "No strategy stated." : "Mandate states no asset classes.",
    });
  }

  const assessed = signals.filter((s) => s.matched !== null);
  const assessableWeight = assessed.reduce((sum, s) => sum + s.weight, 0);
  const earned = assessed.filter((s) => s.matched).reduce((sum, s) => sum + s.weight, 0);
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

  return {
    // Normalized over what could be assessed: two of three signals matching
    // scores the same whether the third was unstated or simply not checked.
    score: assessableWeight > 0 ? Math.round((earned / assessableWeight) * 100) : 0,
    coverage: Number((assessableWeight / totalWeight).toFixed(2)),
    signals,
  };
}

/** The most the deterministic score may move the model's, at full coverage. */
const MAX_DETERMINISTIC_WEIGHT = 0.5;

/**
 * Blend the model's score with the deterministic one, in proportion to
 * coverage. At zero coverage the model's score is returned untouched — there
 * was nothing to check, and inventing a penalty for that would be worse than
 * the drift this module exists to remove.
 */
export function blendFitScore(modelScore: number, fit: MandateFit): number {
  const weight = MAX_DETERMINISTIC_WEIGHT * fit.coverage;
  if (weight <= 0) return modelScore;
  return Math.max(0, Math.min(100, Math.round(modelScore * (1 - weight) + fit.score * weight)));
}

export interface ScoredCandidate extends SourceCandidate {
  /** The deterministic breakdown behind the blended score. */
  mandateFit: MandateFit;
  /** What the model said, before blending — kept so the shift is auditable. */
  modelFitScore: number;
}

/**
 * Attach the deterministic fit to each candidate and replace `fitScore` with
 * the blended value. The model's original is preserved as `modelFitScore`.
 */
export function applyMandateFit<T extends SourceCandidate>(
  candidates: T[],
  mandate: SourcingMandate | null,
): (T & ScoredCandidate)[] {
  return candidates.map((c) => {
    const mandateFit = computeMandateFit(c, mandate);
    return {
      ...c,
      mandateFit,
      modelFitScore: c.fitScore,
      fitScore: blendFitScore(c.fitScore, mandateFit),
    };
  });
}

/**
 * Guarantee a candidate carries its deterministic breakdown, without blending
 * twice.
 *
 * A candidate read back from cache was already scored against this same mandate
 * — the mandate is part of the cache key — so its blend is correct and must be
 * left alone. Re-running applyMandateFit on it would treat the blended figure
 * as the model's and blend again, walking the score toward the deterministic
 * value on every cache hit. Only an entry with no breakdown (one written before
 * this scoring existed) gets scored here.
 */
export function ensureMandateFit<T extends SourceCandidate & Partial<ScoredCandidate>>(
  candidates: T[],
  mandate: SourcingMandate | null,
): (T & ScoredCandidate)[] {
  return candidates.map((c) => {
    if (c.mandateFit && typeof c.modelFitScore === "number") {
      return c as T & ScoredCandidate;
    }
    return applyMandateFit([c], mandate)[0];
  });
}

export const __test = { WEIGHTS, US_REGIONS, statesImplied, strategyTokens, hasPhrase, AMBIGUOUS_STATE_CODES, MAX_DETERMINISTIC_WEIGHT };
