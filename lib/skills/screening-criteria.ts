// lib/skills/screening-criteria.ts
// The structured screening criteria a mandate carries (mandates.screening_criteria)
// and a DEFENSIVE parser that turns the stored jsonb into a typed object the
// deterministic screening/sourcing skills can consume as real input.
//
// Discipline: this parser only ever KEEPS well-typed values. A malformed field is
// dropped, never coerced or invented — a mandate with garbage in one slot yields
// a lean, valid criteria object (or null when nothing survives), never a fabricated
// constraint. Pure, no I/O, fully testable.

/**
 * Structured screening criteria. Intentionally the SAME shape the `screen-deal`
 * (`MandateCriteria`) and `source-deals` (`SourceMandate`) skills already accept,
 * so it flows into them without translation. All keys optional; a silent
 * dimension means "unscored", never a fabricated bound.
 */
export interface ScreeningCriteria {
  sectors?: string[];
  geographies?: string[];
  minRevenue?: number;
  maxRevenue?: number;
  minEbitda?: number;
  maxEbitda?: number;
  maxEnterpriseValue?: number;
  transactionTypes?: string[];
  exclusions?: string[];
}

const STRING_LIST_KEYS = ["sectors", "geographies", "transactionTypes", "exclusions"] as const;
const NUMBER_KEYS = ["minRevenue", "maxRevenue", "minEbitda", "maxEbitda", "maxEnterpriseValue"] as const;

/** A finite, non-negative number, or undefined. Sizes/bands are never negative. */
function cleanNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** A list of non-empty trimmed strings (deduped), or undefined when none survive. */
function cleanStringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.length ? out : undefined;
}

/**
 * Parse the stored jsonb into typed ScreeningCriteria, keeping only well-typed
 * values. Returns null when the input is not an object or nothing valid survives —
 * so callers can treat "no usable criteria" as a single, explicit case. Never throws.
 */
export function parseScreeningCriteria(raw: unknown): ScreeningCriteria | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: ScreeningCriteria = {};

  for (const key of STRING_LIST_KEYS) {
    const list = cleanStringList(src[key]);
    if (list) out[key] = list;
  }
  for (const key of NUMBER_KEYS) {
    const n = cleanNumber(src[key]);
    if (n !== undefined) out[key] = n;
  }

  return Object.keys(out).length ? out : null;
}

/** True when the criteria constrain at least one dimension a skill can score against. */
export function hasUsableCriteria(c: ScreeningCriteria | null | undefined): boolean {
  if (!c) return false;
  return Boolean(
    c.sectors?.length ||
      c.geographies?.length ||
      c.transactionTypes?.length ||
      c.exclusions?.length ||
      c.minRevenue !== undefined ||
      c.maxRevenue !== undefined ||
      c.minEbitda !== undefined ||
      c.maxEbitda !== undefined ||
      c.maxEnterpriseValue !== undefined,
  );
}
