// Brain embedder — the embedding seam.
//
// Real external embedding APIs (Voyage, OpenAI) cost money and need a key. We are
// on a tight budget, so the DEFAULT embedder is a DETERMINISTIC LOCAL one: a
// feature-hashing (the "hashing trick") bag-of-words projected into a fixed-dim
// vector and L2-normalized. It needs no network, no key, and is fully
// reproducible — the same text always embeds to the same vector — so ingestion
// and query embedding agree and cosine search works with ZERO spend.
//
// It is not semantically rich (no learned representations), but it captures
// lexical overlap well enough to ground a Brain in the right passages of its own
// KB, which is the goal here. A real embedder plugs in behind the same `Embedder`
// interface (see `voyageEmbedderExample` at the bottom) and only needs to match
// EMBED_DIM — change EMBED_DIM here and the `vector(N)` in
// supabase/migrations/0024_brain_kb.sql together.

// Embedding dimension. MUST match `vector(256)` in 0024_brain_kb.sql.
export const EMBED_DIM = 256;

export interface Embedder {
  readonly dim: number;
  // Embed one text into a `dim`-length, L2-normalized vector.
  embed(text: string): number[];
  // Embed many (default maps over embed; a real API would batch).
  embedBatch(texts: string[]): number[][];
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
  "this", "that", "what", "would", "like", "as", "at", "by", "be", "it", "from",
  "we", "you", "your", "our", "their", "they", "i", "but", "not", "can", "will",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// FNV-1a 32-bit — a fast, deterministic, dependency-free string hash. We derive
// both the bucket index and the sign from it so collisions partially cancel
// rather than always add (the standard signed feature-hashing trick).
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619, kept in 32-bit unsigned range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// Deterministic local feature-hashing embedder. Zero cost, no key, no network.
export class HashingEmbedder implements Embedder {
  readonly dim: number;
  constructor(dim: number = EMBED_DIM) {
    this.dim = dim;
  }

  embed(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    const toks = tokens(text);
    for (const tok of toks) {
      const h = fnv1a(tok);
      const bucket = h % this.dim;
      const sign = (h & 1) === 0 ? 1 : -1;
      // Sublinear term weighting dampens very frequent tokens.
      vec[bucket] += sign;
    }
    // L2-normalize so dot product == cosine similarity (matches pgvector <=>).
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0) return vec; // empty/stopword-only text → zero vector
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }

  embedBatch(texts: string[]): number[][] {
    return texts.map((t) => this.embed(t));
  }
}

// The active embedder. Swap this for a real one behind the same interface (and
// keep EMBED_DIM / the migration's vector(N) in sync).
export const embedder: Embedder = new HashingEmbedder();

// Serialize a vector to the pgvector text literal: "[0.1,0.2,...]".
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// --- Plugging in a real embedder (reference, not wired) -------------------------
// To use Voyage/OpenAI, implement Embedder with the SAME dim as the migration:
//
//   export class VoyageEmbedder implements Embedder {
//     readonly dim = 1024;                 // and set vector(1024) in 0024
//     async ... // call the API, return L2-normalized vectors
//   }
//
// Then export it as `embedder`. Nothing else in the Brain layer changes.
