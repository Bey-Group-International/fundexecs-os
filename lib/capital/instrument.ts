/* ============================================================================
 * lib/capital/instrument.ts — instrument taxonomy (UI-only, no schema).
 *
 * The capital surface used to split into three rail destinations — Equity, Debt,
 * Hybrid — but `capital_commitments` carries no instrument field. Rather than
 * migrate, we *derive* the instrument from the text already on each row
 * (tranche / notes / LP type) or on each capital provider (subtitle / capital
 * types). This keeps the taxonomy as a search facet, not a data dependency.
 *
 * Default is `equity`: LP capital into a fund is equity unless something on the
 * row explicitly signals debt or a hybrid structure. Hybrid wins over debt
 * (a "convertible note" is hybrid, not debt) so the order of checks matters.
 * ========================================================================= */

export type Instrument = 'equity' | 'debt' | 'hybrid';

/** All instruments plus the "all" sentinel — the chip filter's value space. */
export type InstrumentFilter = 'all' | Instrument;

/** Hybrid first: these structures blend equity + debt and must outrank both. */
const HYBRID_HINTS = [
  'hybrid',
  'convertible',
  'safe',
  'warrant',
  'preferred',
  'pref ',
  'pref-',
  'venture debt', // equity-kicker debt — treated as hybrid by convention
  'revenue-based',
  'revenue based',
  'rbf'
];

const DEBT_HINTS = [
  'debt',
  'loan',
  'note',
  'credit',
  'mezz',
  'mezzanine',
  'bond',
  'facility',
  'term loan',
  'promissory'
];

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  equity: 'Equity',
  debt: 'Debt',
  hybrid: 'Hybrid'
};

/**
 * Classify a free-text haystack into an instrument. Pure + case-insensitive.
 * Unknown / unsignalled text resolves to `equity` (the institutional default).
 */
export function deriveInstrument(...parts: Array<string | null | undefined>): Instrument {
  const hay = parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ')
    .toLowerCase();

  if (!hay) return 'equity';
  if (HYBRID_HINTS.some((h) => hay.includes(h))) return 'hybrid';
  if (DEBT_HINTS.some((h) => hay.includes(h))) return 'debt';
  return 'equity';
}

/** True when a row's derived instrument passes the active chip filter. */
export function matchesInstrument(instrument: Instrument, filter: InstrumentFilter): boolean {
  return filter === 'all' || instrument === filter;
}
