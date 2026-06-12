import {
  BK_AESTHETICS,
  BK_LOGOS,
  BK_TYPES,
  BK_VOICES,
  BRAND_BUILD,
  PALETTES,
  PRESENCE_ITEMS,
  TR_RECOGNITION_OPTS,
  brandKitAesthetic,
  trAgg,
  type BioSpec,
  type BrandKitSpec,
  type BrandValue,
  type CredentialsSpec,
  type TrackDeal
} from './config';

/**
 * lib/brand-studio/persistence.ts — shape guard for the brand-studio jsonb
 * document (pure).
 *
 * One document per org: the published copiloted assets (bio / brand kit /
 * website / credentials specs, validated against each builder's actual option
 * lists with free-text fields capped), and the presence items the operator
 * has set up. Derived numbers (the track-record aggregate) are recomputed
 * here — a client can never write its own MOIC.
 */

/** The copiloted builders that publish a spec. */
export type BrandAssetId = 'bio' | 'brandkit' | 'website' | 'credentials';

export const BRAND_ASSET_IDS: readonly BrandAssetId[] = [
  'bio',
  'brandkit',
  'website',
  'credentials'
] as const;

export function isBrandAssetId(id: string): id is BrandAssetId {
  return (BRAND_ASSET_IDS as readonly string[]).includes(id);
}

/** The set-up (non-copiloted) items the studio tracks. `credentials` stays for legacy docs. */
export const PRESENCE_SETUP_IDS: readonly string[] = [
  'credentials',
  ...PRESENCE_ITEMS.map((p) => p.id)
] as const;

/** asset id → its published spec shape. */
export interface BrandBuiltSpecs {
  bio?: BioSpec;
  brandkit?: BrandKitSpec;
  website?: Record<string, BrandValue>;
  credentials?: CredentialsSpec;
}

export interface BrandStudioDoc {
  /** asset id → published spec (absent = not yet published). */
  built: BrandBuiltSpecs;
  /** Presence/setup item ids that are live (subset of PRESENCE_SETUP_IDS). */
  presence: string[];
}

const MAX_STR = 200;
const MAX_TEXT = 2000;
const MAX_DEALS = 20;

const cap = (v: unknown, max = MAX_STR): string => (typeof v === 'string' ? v.slice(0, max) : '');

const pick = (v: unknown, opts: readonly string[], fallback: string): string =>
  typeof v === 'string' && opts.includes(v) ? v : fallback;

/**
 * Keep only the asset's decision keys, and only values drawn from its option
 * lists — a radio falls back to the recommendation; a multi keeps the valid
 * subset.
 */
function sanitizeDecisions(
  id: 'bio' | 'website',
  raw: Record<string, unknown>
): Record<string, BrandValue> {
  const cfg = BRAND_BUILD[id];
  const out: Record<string, BrandValue> = {};
  for (const dec of cfg.decisions) {
    const v = raw[dec.key];
    if (dec.kind === 'multi') {
      const rec = cfg.rec[dec.key];
      out[dec.key] = Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && dec.opts.includes(x))
        : Array.isArray(rec)
          ? [...rec]
          : [];
    } else {
      const rec = cfg.rec[dec.key];
      out[dec.key] =
        typeof v === 'string' && dec.opts.includes(v)
          ? v
          : typeof rec === 'string'
            ? rec
            : dec.opts[0];
    }
  }
  return out;
}

export function sanitizeBioSpec(input: unknown): BioSpec {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const decisions = sanitizeDecisions('bio', raw);
  return {
    voice: decisions.voice as string,
    length: decisions.length as string,
    include: decisions.include as string[],
    years: cap(raw.years, 20),
    prior: cap(raw.prior),
    win: cap(raw.win),
    edu: cap(raw.edu),
    text: cap(raw.text, MAX_TEXT)
  };
}

export function sanitizeBrandKitSpec(input: unknown): BrandKitSpec {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const voice = pick(raw.voice, BK_VOICES, 'Measured');
  return {
    tagline: cap(raw.tagline),
    logo: pick(raw.logo, BK_LOGOS, 'Monogram'),
    palette: pick(raw.palette, Object.keys(PALETTES), 'Navy & gold'),
    type: pick(raw.type, Object.keys(BK_TYPES), 'Geist · modern'),
    voice,
    aesthetic: pick(raw.aesthetic, BK_AESTHETICS, brandKitAesthetic(voice))
  };
}

export function sanitizeCredentialsSpec(input: unknown): CredentialsSpec {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const deals: TrackDeal[] = (Array.isArray(raw.deals) ? raw.deals : [])
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .slice(0, MAX_DEALS)
    .map((d) => {
      const n = parseFloat(typeof d.multiple === 'string' ? d.multiple : '');
      return {
        company: cap(d.company),
        year: cap(d.year, 8),
        multiple: Number.isFinite(n) && n > 0 && n < 1000 ? String(d.multiple).slice(0, 8) : '',
        status: d.status === 'Unrealized' ? 'Unrealized' : 'Realized'
      };
    });
  const recognition = Array.isArray(raw.recognition)
    ? raw.recognition.filter(
        (x): x is string =>
          typeof x === 'string' && (TR_RECOGNITION_OPTS as readonly string[]).includes(x)
      )
    : [];
  // The aggregate is always recomputed from the sanitized deals — never trusted.
  return { deals, edu: cap(raw.edu), recognition: [...new Set(recognition)], agg: trAgg(deals) };
}

export function sanitizeBrandSpec(id: BrandAssetId, input: unknown): BrandBuiltSpecs[BrandAssetId] {
  switch (id) {
    case 'bio':
      return sanitizeBioSpec(input);
    case 'brandkit':
      return sanitizeBrandKitSpec(input);
    case 'credentials':
      return sanitizeCredentialsSpec(input);
    case 'website': {
      const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      return sanitizeDecisions('website', raw);
    }
  }
}

/** Coerce unknown input into a complete, well-typed brand-studio document. */
export function sanitizeBrandStudioDoc(input: unknown): BrandStudioDoc {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const builtRaw = (raw.built && typeof raw.built === 'object' ? raw.built : {}) as Record<
    string,
    unknown
  >;
  const built: BrandBuiltSpecs = {};
  if ('bio' in builtRaw) built.bio = sanitizeBioSpec(builtRaw.bio);
  if ('brandkit' in builtRaw) built.brandkit = sanitizeBrandKitSpec(builtRaw.brandkit);
  if ('credentials' in builtRaw) built.credentials = sanitizeCredentialsSpec(builtRaw.credentials);
  if ('website' in builtRaw)
    built.website = sanitizeDecisions(
      'website',
      (builtRaw.website && typeof builtRaw.website === 'object' ? builtRaw.website : {}) as Record<
        string,
        unknown
      >
    );
  const presence = Array.isArray(raw.presence)
    ? raw.presence.filter(
        (x): x is string => typeof x === 'string' && PRESENCE_SETUP_IDS.includes(x)
      )
    : [];
  return { built, presence: [...new Set(presence)] };
}
