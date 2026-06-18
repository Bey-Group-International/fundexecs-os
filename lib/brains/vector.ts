// Brain vector store — retrieval seam.
//
// Brains retrieve relevant document context through this interface. The default
// implementation is a dependency-free keyword/overlap ranker over the inline
// document text, which is enough to ground answers in the right passages for the
// demo without any external service or spend.
//
// Production path (now wired): the per-Brain knowledge corpus is embedded into
// pgvector and retrieved via lib/brains/pgvector.ts. This keyword store remains
// the always-available FALLBACK (no DB needed) and the retriever over the user's
// inline documents. The two are complementary, not either/or.

export interface RetrievedChunk {
  source: string;
  text: string;
  score: number;
}

export interface VectorStore {
  retrieve(
    query: string,
    docs: { name: string; content: string }[],
    k?: number,
  ): RetrievedChunk[];
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
  "this", "that", "what", "would", "like", "as", "at", "by", "be", "it", "from",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Split a document into ~paragraph chunks so retrieval returns focused passages.
function chunk(content: string): string[] {
  return content
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// Public chunker for ingestion (lib/brains/embed pipeline + the ingest route).
// Splits on paragraph boundaries, then coalesces very short paragraphs and caps
// chunk length so embeddings stay focused. Shares the paragraph heuristic above.
export function chunkText(content: string, maxChars = 1200): string[] {
  const paras = chunk(content);
  const out: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (p.length >= maxChars) {
      // Flush the buffer, then hard-split the oversized paragraph.
      if (buf) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < p.length; i += maxChars) out.push(p.slice(i, i + maxChars));
      continue;
    }
    if (buf.length + p.length + 2 > maxChars) {
      if (buf) out.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

class KeywordVectorStore implements VectorStore {
  retrieve(query: string, docs: { name: string; content: string }[], k = 4): RetrievedChunk[] {
    const q = new Set(tokens(query));
    if (q.size === 0) {
      // No usable query terms — return the opening passages so there is context.
      return docs
        .flatMap((d) => chunk(d.content).slice(0, 1).map((text) => ({ source: d.name, text, score: 0 })))
        .slice(0, k);
    }
    const scored: RetrievedChunk[] = [];
    for (const d of docs) {
      for (const text of chunk(d.content)) {
        const ts = tokens(text);
        if (ts.length === 0) continue;
        let hits = 0;
        for (const t of ts) if (q.has(t)) hits++;
        const score = hits / Math.sqrt(ts.length); // overlap, length-normalized
        if (score > 0) scored.push({ source: d.name, text, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}

export const vectorStore: VectorStore = new KeywordVectorStore();
