// pgvector-backed KB retrieval for the Brain layer.
//
// Given a query + brainKey, embed the query with the local embedder and retrieve
// the top-k grounding passages from the SHARED `brain_kb_chunks` corpus (filtered
// to that brain). This is the per-Brain knowledge base each Brain reasons over,
// in addition to the user's inline documents.
//
// Retrieval is HYBRID: it fuses the keyless hash-vector cosine ranking with a
// Postgres full-text (ts_rank) ranking via Reciprocal Rank Fusion, through the
// `match_brain_kb_chunks_hybrid` RPC (migration 20260706120000). The hash
// embedder is lexical-leaning with weak semantic separation, so pairing it with
// an explicit full-text signal materially improves recall on obvious keyword
// matches (firm names, "EBITDA", "leveraged buyout"). If that RPC is absent
// (migration not yet applied) it transparently falls back to the pure-vector
// `match_brain_kb_chunks` RPC (migration 0024).
//
// It is defensive by design: any failure (RPC missing, table absent, network,
// empty corpus) returns [] so the caller silently falls back to the keyword
// VectorStore and the demo never breaks.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getEmbedder, toVectorLiteral } from "@/lib/brains/embed";
import type { RetrievedChunk } from "@/lib/brains/vector";

// The hybrid RPC is newer than the generated database.types, so we call it
// through a narrow typed shim rather than widening the whole Database type.
type RpcCall = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: MatchRow[] | null; error: unknown }>;

// Retrieve top-k grounding passages from a Brain's own KB. Tries the hybrid
// (vector + full-text RRF) RPC first, falls back to pure-vector cosine search,
// and returns [] on any error or empty result (caller falls back further).
export async function retrieveBrainKb(
  supabase: SupabaseClient<Database>,
  brainKey: string,
  query: string,
  k = 2,
): Promise<RetrievedChunk[]> {
  try {
    const embedder = getEmbedder();
    const queryText = query || brainKey;
    const queryEmbedding = toVectorLiteral(await embedder.embed(queryText, "query"));
    const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall;

    // 1. Hybrid vector + full-text retrieval (preferred). Passes the raw query
    //    text so Postgres can run websearch_to_tsquery for the lexical signal.
    const hybrid = await rpc("match_brain_kb_chunks_hybrid", {
      query_embedding: queryEmbedding,
      target_brain_key: brainKey,
      query_text: queryText,
      match_count: k,
      // Only rank rows in the query's vector space — different embedding
      // models produce incomparable vectors.
      query_model: embedder.model,
    });
    if (!hybrid.error && hybrid.data) return mapRows(hybrid.data);

    // 2. Fallback: pure-vector cosine search (works before the hybrid
    //    migration is applied).
    const { data, error } = await supabase.rpc("match_brain_kb_chunks", {
      query_embedding: queryEmbedding,
      target_brain_key: brainKey,
      match_count: k,
      query_model: embedder.model,
    });
    if (error || !data) return [];
    return mapRows(data as MatchRow[]);
  } catch {
    return [];
  }
}

function mapRows(rows: MatchRow[]): RetrievedChunk[] {
  return rows.map((row) => ({
    source: row.source,
    text: row.content,
    score: typeof row.similarity === "number" ? row.similarity : 0,
  }));
}

interface MatchRow {
  id: string;
  brain_key: string;
  source: string;
  chunk_index: number;
  content: string;
  similarity: number;
}
