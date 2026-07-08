// lib/ingestion/normalize.ts
// The seam between raw extraction and the first-party catalog. Extraction is
// noisy — duplicate names, empty fields, over-long blurbs, junk categories.
// This module is the PURE cleanup pass that turns ExtractedEntity[] into
// IntelEntityInput[] ready for lib/sourcing-intel.ingestEntities: trim, clamp,
// de-dupe by (kind, lower(name)), dedupe/limit categories, and stamp a
// "web_ingest" provenance so the catalog records where a row came from.
// Deterministic and side-effect-free, so it is fully unit-testable.
import type { EntityKind, IntelEntityInput } from "@/lib/sourcing-intel";
import { ENTITY_KINDS } from "@/lib/sourcing-intel";
import type { ExtractedEntity } from "@/lib/ingestion/extract";

const NAME_MAX = 200;
const DESC_MAX = 1000;
const CATEGORY_MAX = 12;

const KIND_SET = new Set<string>(ENTITY_KINDS);

// Collapse whitespace and trim. Pure.
function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

// Lower-case, de-dupe, drop empties, cap length. Pure.
function normalizeCategories(categories: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of categories ?? []) {
    const v = clean(c).toLowerCase();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
      if (out.length >= CATEGORY_MAX) break;
    }
  }
  return out;
}

/**
 * Normalize + de-dupe a batch of extracted entities into catalog inputs. Rows
 * with no name or an unknown kind are dropped. Later duplicates of the same
 * (kind, name) are merged into the first, filling any fields the first left
 * empty (union of categories). Pure — no I/O.
 */
export function normalizeEntities(
  extracted: ExtractedEntity[],
  opts: { sourceUrl?: string | null; provenance?: string } = {},
): IntelEntityInput[] {
  const provenance = opts.provenance ?? "web_ingest";
  const byKey = new Map<string, IntelEntityInput>();

  for (const e of extracted) {
    const name = clean(e.name).slice(0, NAME_MAX);
    if (!name) continue;
    const kind = (KIND_SET.has(e.kind) ? e.kind : "company") as EntityKind;
    const key = `${kind}:${name.toLowerCase()}`;

    const description = clean(e.description).slice(0, DESC_MAX) || null;
    const categories = normalizeCategories(e.categories);
    const geography = clean(e.geography) || null;
    const domain = clean(e.domain).toLowerCase() || null;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        kind,
        name,
        domain,
        description,
        categories,
        geography,
        provenance,
        sourceUrl: opts.sourceUrl ?? null,
        metadata: e.evidence ? { evidence: e.evidence } : {},
      });
      continue;
    }
    // Merge: fill blanks on the first-seen record, union categories.
    existing.domain ??= domain;
    existing.description ??= description;
    existing.geography ??= geography;
    existing.categories = normalizeCategories([...(existing.categories ?? []), ...categories]);
  }

  return [...byKey.values()];
}

export const __test = { clean, normalizeCategories };
