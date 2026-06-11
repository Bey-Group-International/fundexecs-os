import { BRAND_BUILD, PRESENCE_ITEMS, type BrandValue } from './config';

/**
 * lib/brand-studio/persistence.ts — shape guard for the brand-studio jsonb
 * document (pure).
 *
 * One document per org: the published copiloted assets (bio / brand kit /
 * website specs, validated against each builder's actual option lists), the
 * presence items the operator has set up, and the credentials flag.
 */

/** The copiloted builders that publish a spec. */
export type BrandAssetId = 'bio' | 'brandkit' | 'website';

export const BRAND_ASSET_IDS: readonly BrandAssetId[] = ['bio', 'brandkit', 'website'] as const;

export function isBrandAssetId(id: string): id is BrandAssetId {
  return (BRAND_ASSET_IDS as readonly string[]).includes(id) && id in BRAND_BUILD;
}

/** The set-up (non-copiloted) items the studio tracks. */
export const PRESENCE_SETUP_IDS: readonly string[] = [
  'credentials',
  ...PRESENCE_ITEMS.map((p) => p.id)
] as const;

export interface BrandStudioDoc {
  /** asset id → published spec (absent = not yet published). */
  built: Partial<Record<BrandAssetId, Record<string, BrandValue>>>;
  /** Presence/setup item ids that are live (subset of PRESENCE_SETUP_IDS). */
  presence: string[];
}

/**
 * Keep only the asset's decision keys, and only values drawn from its option
 * lists — a radio falls back to the recommendation; a multi keeps the valid
 * subset.
 */
export function sanitizeBrandSpec(id: BrandAssetId, input: unknown): Record<string, BrandValue> {
  const cfg = BRAND_BUILD[id];
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
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

/** Coerce unknown input into a complete, well-typed brand-studio document. */
export function sanitizeBrandStudioDoc(input: unknown): BrandStudioDoc {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const builtRaw = (raw.built && typeof raw.built === 'object' ? raw.built : {}) as Record<
    string,
    unknown
  >;
  const built: BrandStudioDoc['built'] = {};
  for (const id of BRAND_ASSET_IDS) {
    if (id in builtRaw) built[id] = sanitizeBrandSpec(id, builtRaw[id]);
  }
  const presence = Array.isArray(raw.presence)
    ? raw.presence.filter(
        (x): x is string => typeof x === 'string' && PRESENCE_SETUP_IDS.includes(x)
      )
    : [];
  return { built, presence: [...new Set(presence)] };
}
