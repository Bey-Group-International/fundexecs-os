// lib/intelligence/entity-match.ts
// Native entity resolution — map an observation's entity hints to the entities a
// workspace tracks. Pure + tested; the ingestion pipeline persists the results.
//
// Match precedence (strongest first): external identifier > exact name > alias >
// inferred (token overlap). Each match carries its method and a 0–1 confidence,
// so a weak inferred link is never presented as a confirmed relationship.

import type { EntityHint, MatchMethod, TrackedEntity } from "./types";

/** Lowercase, trim, collapse whitespace, drop punctuation and common suffixes. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\b(inc|llc|lp|ltd|corp|co|company|partners|capital|group|holdings|fund)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter((t) => t.length > 1));
}

/** Jaccard overlap of two token sets, 0–1. */
function tokenOverlap(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export interface EntityMatch {
  entity: TrackedEntity;
  method: MatchMethod;
  confidence: number; // 0–1
  providerRelationship: string | null;
}

// Minimum token overlap for an inferred match — below this we do NOT link.
const INFERRED_THRESHOLD = 0.5;

/**
 * Resolve one hint against the tracked universe, returning the single best match
 * (or null). External-id and exact matches are confident (0.95–1.0); alias 0.85;
 * inferred scales with overlap and is capped so it always reads as tentative.
 */
export function matchHint(hint: EntityHint, universe: TrackedEntity[]): EntityMatch | null {
  const rel = hint.providerRelationship ?? null;

  // 1. External identifier — the strongest signal, order-independent.
  if (hint.externalIdentifiers) {
    for (const [k, v] of Object.entries(hint.externalIdentifiers)) {
      if (!v) continue;
      const hit = universe.find((e) => (e.externalIdentifiers?.[k] ?? "").toLowerCase() === v.toLowerCase());
      if (hit) return { entity: hit, method: "external_id", confidence: 1.0, providerRelationship: rel };
    }
  }

  const target = normalizeName(hint.name);
  if (!target) return null;

  // 2. Exact normalized name.
  const exact = universe.find((e) => normalizeName(e.name) === target);
  if (exact) return { entity: exact, method: "exact", confidence: 0.95, providerRelationship: rel };

  // 3. Alias.
  const aliasHit = universe.find((e) => e.aliases.some((a) => normalizeName(a) === target));
  if (aliasHit) return { entity: aliasHit, method: "alias", confidence: 0.85, providerRelationship: rel };

  // 4. Inferred (token overlap) — only above threshold, capped tentative.
  let best: EntityMatch | null = null;
  for (const e of universe) {
    const overlap = tokenOverlap(hint.name, e.name);
    if (overlap >= INFERRED_THRESHOLD) {
      const confidence = Math.min(0.75, 0.4 + overlap * 0.4);
      if (!best || confidence > best.confidence) {
        best = { entity: e, method: "inferred", confidence, providerRelationship: rel };
      }
    }
  }
  return best;
}

/** Resolve every hint, de-duplicating to the strongest match per entity. */
export function matchEntities(hints: EntityHint[], universe: TrackedEntity[]): EntityMatch[] {
  const byEntity = new Map<string, EntityMatch>();
  for (const hint of hints) {
    const m = matchHint(hint, universe);
    if (!m) continue;
    const existing = byEntity.get(m.entity.id);
    if (!existing || m.confidence > existing.confidence) byEntity.set(m.entity.id, m);
  }
  return [...byEntity.values()];
}

/** The strongest match confidence across all hints (0 when nothing matched). */
export function bestMatchStrength(matches: EntityMatch[]): number {
  return matches.reduce((mx, m) => Math.max(mx, m.confidence), 0);
}
