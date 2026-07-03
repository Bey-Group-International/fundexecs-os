// Brain embedder — the embedding seam.
//
// Two implementations behind one async interface:
//
//   - HashingEmbedder (default, keyless): a deterministic feature-hashing
//     bag-of-words vector. No network, no key, zero spend, fully reproducible —
//     lexical overlap only, but enough to ground a Brain in its own KB.
//   - VoyageEmbedder (real, when VOYAGE_API_KEY is set): learned semantic
//     embeddings from Voyage AI. The 3.5-generation models are Matryoshka-
//     trained, so we request output_dimension = EMBED_DIM (256) and the vectors
//     land in the EXISTING vector(256) column — no destructive migration, no
//     index rebuild.
//
// The two vector spaces are NOT comparable: a hash query must never rank
// voyage-embedded rows or vice versa. Every embedder therefore carries a
// `model` identity; rows are stamped with it at write time
// (brain_kb_chunks.embedding_model) and retrieval filters to the active
// model. Rows in a stale space are re-embedded by the backfill route
// (app/api/brains/reembed) rather than silently mis-ranked.

// Embedding dimension. MUST match `vector(256)` in 0024_brain_kb.sql.
export const EMBED_DIM = 256;

/** What the text is for — real retrieval models embed queries and documents differently. */
export type EmbedKind = "query" | "document";

export interface Embedder {
  readonly dim: number;
  // Identity of the vector space this embedder writes/queries — stamped on
  // rows and filtered at retrieval so incompatible spaces never mix.
  readonly model: string;
  // Embed one text into a `dim`-length, L2-normalized vector.
  embed(text: string, kind?: EmbedKind): Promise<number[]>;
  // Embed many at once (real APIs batch; the hash embedder just maps).
  embedBatch(texts: string[], kind?: EmbedKind): Promise<number[][]>;
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

function l2Normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

// Deterministic local feature-hashing embedder. Zero cost, no key, no network.
export class HashingEmbedder implements Embedder {
  readonly dim: number;
  readonly model = "hash-v1";
  constructor(dim: number = EMBED_DIM) {
    this.dim = dim;
  }

  embedSync(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    for (const tok of tokens(text)) {
      const h = fnv1a(tok);
      const bucket = h % this.dim;
      const sign = (h & 1) === 0 ? 1 : -1;
      vec[bucket] += sign;
    }
    // L2-normalize so dot product == cosine similarity (matches pgvector <=>).
    return l2Normalize(vec);
  }

  async embed(text: string): Promise<number[]> {
    return this.embedSync(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedSync(t));
  }
}

// Voyage AI embedder — real semantic vectors in the existing 256-dim space via
// Matryoshka output_dimension. Throws on API failure: retrieval callers already
// degrade to their keyword fallback, and ingestion must fail loudly rather than
// write vectors from the wrong space.
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_VOYAGE_MODEL = "voyage-3.5-lite";
// Voyage accepts up to 128 inputs per request; stay comfortably under.
const VOYAGE_BATCH = 100;

export class VoyageEmbedder implements Embedder {
  readonly dim: number;
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, modelName: string = DEFAULT_VOYAGE_MODEL, dim: number = EMBED_DIM) {
    this.apiKey = apiKey;
    this.dim = dim;
    // The vector space is the (model, dim) pair — a future dim change is a new
    // space and triggers the same backfill path as a model change.
    this.model = `${modelName}@${dim}`;
  }

  private get modelName(): string {
    return this.model.split("@")[0];
  }

  private async call(inputs: string[], kind: EmbedKind): Promise<number[][]> {
    const response = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelName,
        input: inputs,
        input_type: kind,
        output_dimension: this.dim,
      }),
    });
    if (!response.ok) {
      throw new Error(`voyage embeddings failed: ${response.status}`);
    }
    const body = (await response.json()) as {
      data?: { index?: number; embedding?: number[] }[];
    };
    const rows = body.data ?? [];
    if (rows.length !== inputs.length) {
      throw new Error(`voyage returned ${rows.length} embeddings for ${inputs.length} inputs`);
    }
    // Order by index (the API preserves order, but the contract is the index
    // field), validate width, and normalize defensively.
    const out = new Array<number[]>(inputs.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const vec = row.embedding;
      if (!Array.isArray(vec) || vec.length !== this.dim) {
        throw new Error(`voyage embedding has wrong dimension (expected ${this.dim})`);
      }
      out[row.index ?? i] = l2Normalize([...vec]);
    }
    return out;
  }

  async embed(text: string, kind: EmbedKind = "document"): Promise<number[]> {
    const [vec] = await this.call([text], kind);
    return vec;
  }

  async embedBatch(texts: string[], kind: EmbedKind = "document"): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += VOYAGE_BATCH) {
      out.push(...(await this.call(texts.slice(i, i + VOYAGE_BATCH), kind)));
    }
    return out;
  }
}

/**
 * The active embedder: Voyage when VOYAGE_API_KEY is configured, else the
 * keyless hash embedder — the same mock-or-real discipline as every other
 * provider seam. Resolved per call (not at module load) so tests and runtime
 * env changes behave predictably.
 */
export function getEmbedder(): Embedder {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (apiKey) {
    return new VoyageEmbedder(apiKey, process.env.VOYAGE_EMBED_MODEL || DEFAULT_VOYAGE_MODEL);
  }
  return new HashingEmbedder();
}

// Serialize a vector to the pgvector text literal: "[0.1,0.2,...]".
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
