import { MATERIAL_BUILD, MAT_DOCS, materialDefaults, type MaterialValue } from './config';

/**
 * lib/dataroom/persistence.ts — shape guards for the Materials & Data Room
 * flow (pure).
 *
 * The flow's six investor materials persist into the existing
 * `capital_materials` table (kinds widened by migration); the operator's
 * build decisions ride along as `spec jsonb`. These helpers map the flow's
 * short ids onto the DB kinds and validate every spec that round-trips
 * through jsonb against the material's actual option lists.
 */

/** flow id → capital_materials.kind (must match the widened check constraint). */
export const MATERIAL_DB_KIND: Record<string, string> = {
  deck: 'pitch_deck',
  onepager: 'lp_one_pager',
  ddq: 'ddq',
  track: 'track_record',
  model: 'financial_model',
  update: 'lp_update'
};

const DB_KIND_TO_ID = Object.fromEntries(
  Object.entries(MATERIAL_DB_KIND).map(([id, kind]) => [kind, id])
);

export function materialIdForDbKind(kind: string): string | null {
  return DB_KIND_TO_ID[kind] ?? null;
}

export function isMaterialId(id: string): boolean {
  return (MAT_DOCS as readonly string[]).includes(id) && id in MATERIAL_BUILD;
}

/**
 * Keep only the material's decision keys, and only values drawn from its
 * option lists — a radio falls back to the recommendation when the stored
 * value is unknown; a multi keeps the valid subset.
 */
export function sanitizeMaterialSpec(id: string, input: unknown): Record<string, MaterialValue> {
  const cfg = MATERIAL_BUILD[id];
  if (!cfg) return {};
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Record<string, MaterialValue> = {};
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

/** A complete default spec for a material (the recommendation). */
export function defaultMaterialSpec(id: string): Record<string, MaterialValue> {
  const cfg = MATERIAL_BUILD[id];
  return cfg ? materialDefaults(cfg) : {};
}

/* ── viewer rows (`data_room_views`) ─────────────────────────────────────── */

/** Cap on logged views per link — a leaked link can't flood the room. */
export const VIEWS_PER_LINK_CAP = 500;

/** `data_room_views.viewer` stores "Name · email"; split it for display. */
export function splitStoredViewer(viewer: string): { name: string; email: string | null } {
  const sep = viewer.lastIndexOf(' · ');
  if (sep < 0) return { name: viewer, email: null };
  return { name: viewer.slice(0, sep), email: viewer.slice(sep + 3) || null };
}

/** Viewer-supplied name: strip control characters, collapse whitespace. */
export function sanitizeViewerName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Viewer-supplied email, normalized as the dedupe key. */
export function normalizeViewerEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().slice(0, 200);
}
