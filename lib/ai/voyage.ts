import 'server-only';

// Voyage AI embeddings (Anthropic's recommended embedding provider).
// voyage-3.5 at 1024 dimensions matches the knowledge_chunks vector column.
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = 'voyage-3.5';
export const EMBEDDING_DIM = 1024;

// Abort a stalled provider call so callers (e.g. the intelligence cron) fail
// fast instead of hanging and delaying later phases.
const VOYAGE_TIMEOUT_MS = 20_000;

type VoyageResponse = { data: { embedding: number[] }[] };

/** Embed a batch of texts. `inputType` tunes the embedding for storage vs. search. */
export async function embedTexts(
  texts: string[],
  inputType: 'document' | 'query' = 'document'
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('Missing VOYAGE_API_KEY');
  if (texts.length === 0) return [];

  let res: Response;
  try {
    res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        input: texts,
        input_type: inputType,
        output_dimension: EMBEDDING_DIM
      }),
      signal: AbortSignal.timeout(VOYAGE_TIMEOUT_MS)
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(`Voyage API timed out after ${VOYAGE_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Voyage API error ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as VoyageResponse;
  return body.data.map((d) => d.embedding);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text], 'query');
  return vector;
}

/** pgvector accepts a `[a,b,c]` text literal cast to the vector type. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
