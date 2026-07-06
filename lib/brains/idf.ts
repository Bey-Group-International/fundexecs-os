// Inverse document frequency for the native hash embedder (hash-v3).
//
// The hash embedder (embed.ts) weights each feature by sublinear term frequency.
// TF alone treats a domain stopword ("capital", "fund", "management" — which
// appear in almost every chunk of this KB) the same as a discriminating term
// ("clawback", "mezzanine", "escrow"). IDF fixes that: a feature that appears in
// many chunks is down-weighted, a rare one is boosted, so the vector's direction
// is dominated by what actually distinguishes a passage.
//
// The table is precomputed over the committed Brain KB corpus and shipped as
// idf-table.json (generated + verified by idf-table.test.ts). Query and document
// embeddings must use the SAME weights, so a static corpus-derived table — not a
// per-request computation — is what keeps the two vector spaces comparable.
//
// Fully native: no service, no key, deterministic. Features below the frequency
// floor (and any novel query term) fall back to `default`, the IDF of a df=1
// term, so rare/unseen features keep their full discriminating weight.

import { features } from "@/lib/brains/embed";

export interface IdfTable {
  // Number of chunks (documents) the table was built over.
  chunkCount: number;
  // IDF for a feature not present in `idf` — the df=1 (rare-term) value.
  default: number;
  // feature → IDF, only for features at or above the frequency floor.
  idf: Record<string, number>;
}

// Smoothed IDF (sklearn's smooth_idf): idf = ln((N + 1) / (df + 1)) + 1.
// Monotonic decreasing in df, always > 0, and equals 1 for a feature present in
// every chunk — so ubiquitous terms are flattened, not zeroed.
export function idfValue(chunkCount: number, df: number): number {
  return Math.log((chunkCount + 1) / (df + 1)) + 1;
}

// Round to 3 decimals so the committed JSON is compact and stable across runs.
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// Build the IDF table from a corpus of chunks. Only features seen in at least
// `minDocFreq` chunks are stored; everything rarer shares `default` (the df=1
// value), which halves the table without losing the down-weighting that matters.
export function buildIdfTable(chunks: string[], minDocFreq = 2): IdfTable {
  const chunkCount = chunks.length;
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    // Count each feature once per chunk — document frequency, not term frequency.
    for (const feat of new Set(features(chunk))) {
      df.set(feat, (df.get(feat) ?? 0) + 1);
    }
  }

  const idf: Record<string, number> = {};
  // Deterministic key order so the serialized JSON is byte-stable run to run.
  for (const feat of [...df.keys()].sort()) {
    const d = df.get(feat)!;
    if (d >= minDocFreq) idf[feat] = round3(idfValue(chunkCount, d));
  }

  return { chunkCount, default: round3(idfValue(chunkCount, 1)), idf };
}
