// lib/sourcing-intel.ts
// The Sourcing Intelligence engine — semantic discovery + lookalike search over
// the first-party entity catalog (migration 0042). This is the FundExecs answer
// to Grata/Inven/Cyndx "find companies like X" and natural-language firmographic
// search, built on infrastructure we already have:
//
//   • Embeddings: the deterministic, zero-cost local embedder (lib/brains/embed),
//     so discovery works in CI/preview with no key and no spend. A real embedder
//     (Voyage/OpenAI) plugs in behind the same seam — the "adapter-ready" choice.
//   • Retrieval: pgvector cosine search via the match_sourcing_entities RPC.
//   • Fallback: a deterministic lexical+facet score, so search still returns
//     sensible results if the RPC/extension is unavailable.
//
// The catalog grows from real usage: accepted AI candidates are mirrored in, and
// the operator can index their live pipeline. Every search is org-scoped (RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { embedder, toVectorLiteral } from "@/lib/brains/embed";

type Client = SupabaseClient<Database>;

export type EntityKind = "company" | "investor" | "fund" | "advisor" | "lender" | "provider";
export const ENTITY_KINDS: EntityKind[] = ["company", "investor", "fund", "advisor", "lender", "provider"];

// A normalized entity ready to ingest into the catalog.
export interface IntelEntityInput {
  kind: EntityKind;
  name: string;
  domain?: string | null;
  description?: string | null;
  categories?: string[];
  geography?: string | null;
  metadata?: Record<string, unknown>;
  provenance?: string;
  sourceUrl?: string | null;
}

// A ranked discovery result returned to the surfaces.
export interface DiscoveryHit {
  id: string | null;
  kind: string;
  name: string;
  domain: string | null;
  description: string | null;
  categories: string[];
  geography: string | null;
  sourceUrl: string | null;
  provenance: string;
  /** 0–100 relevance (cosine similarity or lexical fallback, scaled). */
  score: number;
}

// Map a Source pipeline module to the catalog entity kind it represents.
export function entityKindForModule(moduleKey: string): EntityKind {
  switch (moduleKey.replace(/^source\//, "")) {
    case "lp_pipeline":
      return "investor";
    case "deal_pipeline":
      return "company";
    case "debt":
      return "lender";
    case "partners":
      return "advisor";
    case "providers":
      return "provider";
    default:
      return "company";
  }
}

// The text we embed / lexically match: name + facets + description. Pure.
export function composeEmbedText(e: {
  name: string;
  categories?: string[] | null;
  geography?: string | null;
  description?: string | null;
}): string {
  return [
    e.name,
    (e.categories ?? []).join(" "),
    e.geography ?? "",
    e.description ?? "",
  ]
    .filter(Boolean)
    .join(". ")
    .trim();
}

// Deterministic lexical+facet similarity in [0,1] — the no-pgvector fallback.
// Token Jaccard over the composed text, lightly boosted by exact facet overlap.
export function lexicalScore(
  query: string,
  e: { name: string; categories?: string[] | null; geography?: string | null; description?: string | null },
): number {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const q = new Set(norm(query));
  if (q.size === 0) return 0;
  const text = new Set(norm(composeEmbedText(e)));
  if (text.size === 0) return 0;
  let overlap = 0;
  for (const t of q) if (text.has(t)) overlap += 1;
  const jaccard = overlap / (q.size + text.size - overlap);
  // Facet boost: query terms that hit a category exactly are strong signal.
  const cats = new Set((e.categories ?? []).flatMap((c) => norm(c)));
  let facet = 0;
  for (const t of q) if (cats.has(t)) facet += 1;
  const facetBoost = Math.min(0.3, facet * 0.1);
  return Math.min(1, jaccard + facetBoost);
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n * 100)));

// ---------------------------------------------------------------------------
// INGEST — grow the catalog (best-effort; never throws)
// ---------------------------------------------------------------------------
/**
 * Upsert entities into the org's catalog with embeddings, de-duped by
 * (kind, lower(name)). Returns the count of new rows inserted. Best-effort: any
 * failure returns 0 so ingestion never breaks the action that triggered it.
 */
export async function ingestEntities(
  supabase: Client,
  orgId: string,
  userId: string | null,
  entities: IntelEntityInput[],
): Promise<number> {
  const clean = entities
    .map((e) => ({ ...e, name: (e.name ?? "").trim() }))
    .filter((e) => e.name);
  if (clean.length === 0) return 0;
  try {
    // De-dupe against existing rows for the kinds in this batch.
    const kinds = [...new Set(clean.map((e) => e.kind))];
    const { data: existing } = await supabase
      .from("sourcing_entities")
      .select("kind, name")
      .eq("organization_id", orgId)
      .in("kind", kinds);
    const seen = new Set(
      ((existing ?? []) as { kind: string; name: string }[]).map((r) => `${r.kind}:${r.name.toLowerCase()}`),
    );
    const rows = clean
      .filter((e) => {
        const key = `${e.kind}:${e.name.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((e) => ({
        organization_id: orgId,
        kind: e.kind,
        name: e.name.slice(0, 200),
        domain: e.domain ?? null,
        description: e.description?.slice(0, 1000) ?? null,
        categories: (e.categories ?? []).slice(0, 12),
        geography: e.geography ?? null,
        metadata: (e.metadata ?? {}) as Database["public"]["Tables"]["sourcing_entities"]["Insert"]["metadata"],
        provenance: e.provenance ?? "manual",
        source_url: e.sourceUrl ?? null,
        created_by: userId,
        embedding: toVectorLiteral(
          embedder.embed(
            composeEmbedText({
              name: e.name,
              categories: e.categories,
              geography: e.geography,
              description: e.description,
            }),
          ),
        ),
      }));
    if (rows.length === 0) return 0;
    const { error } = await supabase.from("sourcing_entities").insert(rows);
    return error ? 0 : rows.length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// SEARCH — natural-language semantic discovery
// ---------------------------------------------------------------------------
interface MatchRow {
  id: string;
  kind: string;
  name: string;
  domain: string | null;
  description: string | null;
  categories: string[] | null;
  geography: string | null;
  source_url: string | null;
  provenance: string;
  similarity: number;
}

function toHit(row: MatchRow): DiscoveryHit {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    domain: row.domain,
    description: row.description,
    categories: row.categories ?? [],
    geography: row.geography,
    sourceUrl: row.source_url,
    provenance: row.provenance,
    score: clampPct(typeof row.similarity === "number" ? row.similarity : 0),
  };
}

// Lexical fallback over a fetched slice of the catalog (when the RPC is absent).
async function lexicalSearch(
  supabase: Client,
  orgId: string,
  query: string,
  kind: EntityKind | null,
  k: number,
  excludeId?: string,
): Promise<DiscoveryHit[]> {
  try {
    let q = supabase
      .from("sourcing_entities")
      .select("id, kind, name, domain, description, categories, geography, source_url, provenance")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (kind) q = q.eq("kind", kind);
    const { data } = await q;
    const rows = (data ?? []) as Omit<MatchRow, "similarity">[];
    return rows
      .filter((r) => r.id !== excludeId)
      .map((r) => ({ ...toHit({ ...r, similarity: 0 }), score: clampPct(lexicalScore(query, { name: r.name, categories: r.categories, geography: r.geography, description: r.description })) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  } catch {
    return [];
  }
}

/**
 * Semantic search the org's catalog for an NL query. Embeds the query and cosine-
 * searches via the RPC; on any failure falls back to deterministic lexical match.
 */
export async function semanticSearch(
  supabase: Client,
  orgId: string,
  query: string,
  opts: { kind?: EntityKind | null; k?: number } = {},
): Promise<DiscoveryHit[]> {
  const clean = (query ?? "").trim();
  if (!clean) return [];
  const k = opts.k ?? 8;
  const kind = opts.kind ?? null;
  try {
    const { data, error } = await supabase.rpc("match_sourcing_entities", {
      query_embedding: toVectorLiteral(embedder.embed(clean)),
      target_org: orgId,
      match_count: k,
      filter_kind: kind,
    });
    if (error || !data || (data as MatchRow[]).length === 0) {
      return lexicalSearch(supabase, orgId, clean, kind, k);
    }
    return (data as MatchRow[]).map(toHit);
  } catch {
    return lexicalSearch(supabase, orgId, clean, kind, k);
  }
}

/**
 * Lookalike search: given a catalog entity, find the most similar OTHER entities.
 * The deterministic embedder reproduces the entity's vector from its text, so we
 * never need to read the stored vector back.
 */
export async function findSimilar(
  supabase: Client,
  orgId: string,
  entity: { id?: string; name: string; categories?: string[] | null; geography?: string | null; description?: string | null; kind?: EntityKind | null },
  opts: { k?: number } = {},
): Promise<DiscoveryHit[]> {
  const text = composeEmbedText(entity);
  if (!text) return [];
  const k = opts.k ?? 6;
  const kind = entity.kind ?? null;
  try {
    const { data, error } = await supabase.rpc("match_sourcing_entities", {
      query_embedding: toVectorLiteral(embedder.embed(text)),
      target_org: orgId,
      match_count: k,
      filter_kind: kind,
      exclude_id: entity.id ?? null,
    });
    if (error || !data || (data as MatchRow[]).length === 0) {
      return lexicalSearch(supabase, orgId, text, kind, k, entity.id);
    }
    return (data as MatchRow[]).map(toHit);
  } catch {
    return lexicalSearch(supabase, orgId, text, kind, k, entity.id);
  }
}

export const __test = {
  entityKindForModule,
  composeEmbedText,
  lexicalScore,
};
