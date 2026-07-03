// pgvector-backed KB retrieval for the Brain layer.
//
// Given a query + brainKey, embed the query with the local embedder and cosine-
// search the SHARED `brain_kb_chunks` corpus (filtered to that brain) via the
// `match_brain_kb_chunks` RPC (migration 0024). This is the per-Brain knowledge
// base each Brain reasons over, in addition to the user's inline documents.
//
// It is defensive by design: any failure (RPC missing, table absent, network,
// empty corpus) returns [] so the caller silently falls back to the keyword
// VectorStore and the demo never breaks.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getEmbedder, toVectorLiteral } from "@/lib/brains/embed";
import type { RetrievedChunk } from "@/lib/brains/vector";

// Retrieve top-k grounding passages from a Brain's own KB via pgvector cosine
// search. Returns [] on any error or empty result (caller falls back).
export async function retrieveBrainKb(
  supabase: SupabaseClient<Database>,
  brainKey: string,
  query: string,
  k = 2,
): Promise<RetrievedChunk[]> {
  try {
    const embedder = getEmbedder();
    const queryEmbedding = toVectorLiteral(await embedder.embed(query || brainKey, "query"));
    const { data, error } = await supabase.rpc("match_brain_kb_chunks", {
      query_embedding: queryEmbedding,
      target_brain_key: brainKey,
      match_count: k,
      // Only rank rows in the query's vector space — hash and voyage vectors
      // are not comparable.
      query_model: embedder.model,
    });
    if (error || !data) return [];
    return (data as MatchRow[]).map((row) => ({
      source: row.source,
      text: row.content,
      score: typeof row.similarity === "number" ? row.similarity : 0,
    }));
  } catch {
    return [];
  }
}

interface MatchRow {
  id: string;
  brain_key: string;
  source: string;
  chunk_index: number;
  content: string;
  similarity: number;
}
