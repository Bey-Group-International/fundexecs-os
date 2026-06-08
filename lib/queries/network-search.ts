import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/network-search.ts — hybrid LP & Partner search read layer.
 *
 * Thin typed wrapper over the `search_network` RPC: semantic (pgvector cosine)
 * + keyword + structured filters across the org's contacts, service providers,
 * and capital providers. The RPC enforces org membership; this layer just
 * shapes params and results. Query embedding (when present) is produced by the
 * server action and passed through as a pgvector text literal.
 * ========================================================================= */

export type NetworkKind = 'contact' | 'service_provider' | 'capital_provider';

export interface NetworkSearchParams {
  /** Plain-language query; drives keyword ILIKE and (with an embedding) semantic. */
  queryText?: string | null;
  /** pgvector text literal `[a,b,...]` for semantic similarity, when available. */
  queryEmbedding?: string | null;
  kinds?: NetworkKind[];
  capitalTypes?: string[] | null;
  category?: string | null;
  checkMin?: number | null;
  checkMax?: number | null;
  limit?: number;
}

export interface NetworkSearchResult {
  kind: NetworkKind;
  id: string;
  name: string;
  subtitle: string | null;
  /** 0..1 cosine similarity when both query + row are embedded; else null. */
  similarity: number | null;
  /** True when this person/firm is already in your network (warm intro path). */
  alreadyConnected: boolean;
  metadata: Record<string, unknown>;
}

interface RawRow {
  kind: string;
  id: string;
  name: string;
  subtitle: string | null;
  similarity: number | null;
  already_connected: boolean;
  metadata: unknown;
}

/** Loose RPC shape — `search_network` is additive and not in generated types. */
type SearchRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: RawRow[] | null; error: { message: string } | null }>;
};

export async function searchNetwork(
  orgId: string,
  params: NetworkSearchParams
): Promise<NetworkSearchResult[]> {
  const supabase = await createClient();
  // Call `.rpc` as a method on the client (don't detach it — it needs `this`).
  const client = supabase as unknown as SearchRpc;

  const { data, error } = await client.rpc('search_network', {
    _org_id: orgId,
    _query_text: params.queryText ?? null,
    _query_embedding: params.queryEmbedding ?? null,
    _kinds: params.kinds ?? ['contact', 'service_provider', 'capital_provider'],
    _capital_types: params.capitalTypes ?? null,
    _category: params.category ?? null,
    _check_min: params.checkMin ?? null,
    _check_max: params.checkMax ?? null,
    _limit: params.limit ?? 40
  });

  if (error) throw new Error(`search_network failed: ${error.message}`);
  if (!data) return [];

  return data.map((r) => ({
    kind: (r.kind as NetworkKind) ?? 'contact',
    id: r.id,
    name: r.name,
    subtitle: r.subtitle,
    similarity: typeof r.similarity === 'number' ? r.similarity : null,
    alreadyConnected: Boolean(r.already_connected),
    metadata:
      r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
        ? (r.metadata as Record<string, unknown>)
        : {}
  }));
}
