'use server';

import { getActiveOrg } from '@/lib/queries/org';
import {
  searchNetwork,
  type NetworkKind,
  type NetworkSearchResult
} from '@/lib/queries/network-search';
import { embedQuery, toVectorLiteral } from '@/lib/ai/voyage';

/* ============================================================================
 * lib/actions/network-search.ts — LP & Partner hybrid search action.
 *
 * Embeds the query (Voyage, never-block) for meaning-level matching, then runs
 * the org-scoped `search_network` RPC. Keyword + filters always work; the
 * semantic term simply activates once VOYAGE_API_KEY is set and records carry
 * embeddings.
 * ========================================================================= */

export interface NetworkSearchInput {
  query?: string;
  kinds?: NetworkKind[];
  capitalTypes?: string[];
  category?: string | null;
  checkMin?: number | null;
  checkMax?: number | null;
  limit?: number;
}

export interface NetworkSearchResponse {
  ok: boolean;
  results: NetworkSearchResult[];
  semantic: boolean;
  error?: string;
}

export async function runNetworkSearch(input: NetworkSearchInput): Promise<NetworkSearchResponse> {
  try {
    const org = await getActiveOrg();
    if (!org) return { ok: false, results: [], semantic: false, error: 'not_signed_in' };

    const query = (input.query ?? '').trim();

    // Best-effort query embedding — degrade to keyword-only on any failure.
    let queryEmbedding: string | null = null;
    if (query && process.env.VOYAGE_API_KEY) {
      try {
        const vector = await embedQuery(query);
        if (vector?.length) queryEmbedding = toVectorLiteral(vector);
      } catch {
        queryEmbedding = null;
      }
    }

    const results = await searchNetwork(org.orgId, {
      queryText: query || null,
      queryEmbedding,
      kinds: input.kinds,
      capitalTypes: input.capitalTypes && input.capitalTypes.length ? input.capitalTypes : null,
      category: input.category ?? null,
      checkMin: input.checkMin ?? null,
      checkMax: input.checkMax ?? null,
      limit: input.limit ?? 40
    });

    return { ok: true, results, semantic: queryEmbedding !== null };
  } catch (err) {
    return {
      ok: false,
      results: [],
      semantic: false,
      error: err instanceof Error ? err.message : 'unknown'
    };
  }
}
