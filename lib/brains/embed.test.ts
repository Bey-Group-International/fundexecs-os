// Coverage for the embedding seam (audit P2 — voyageEmbedder). The contracts:
// the hash embedder stays deterministic and normalized (the keyless fallback
// must not drift); the Voyage embedder sends the exact request shape
// (Matryoshka output_dimension so vectors fit the existing vector(256)
// column), validates what comes back, and throws rather than returning
// vectors from the wrong space; and getEmbedder() picks by env — the same
// mock-or-real discipline as every other provider seam.
import {
  EMBED_DIM,
  HashingEmbedder,
  VoyageEmbedder,
  getEmbedder,
  toVectorLiteral,
} from "./embed";

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function voyageResponse(vectors: number[][], ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({
      data: vectors.map((embedding, index) => ({ index, embedding })),
    }),
  };
}

function unitVector(dim: number, hot: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[hot] = 1;
  return v;
}

beforeEach(() => {
  fetchMock.mockReset();
  delete process.env.VOYAGE_API_KEY;
  delete process.env.VOYAGE_EMBED_MODEL;
});

describe("HashingEmbedder", () => {
  const embedder = new HashingEmbedder();

  it("is deterministic, normalized, and the declared width", async () => {
    const a = await embedder.embed("capital call notice for Fund II");
    const b = await embedder.embed("capital call notice for Fund II");
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBED_DIM);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(embedder.model).toBe("hash-v3");
  });

  it("never calls the network", async () => {
    await embedder.embedBatch(["one", "two"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives phrase order weight via bigrams", async () => {
    // Same word bag, different order — a pure unigram model would rank these
    // identical. Bigrams make the phrase-faithful text the closer match.
    const query = await embedder.embed("leveraged buyout exit multiple");
    const phrase = await embedder.embed("the leveraged buyout drove the exit multiple");
    const scrambled = await embedder.embed("multiple leveraged the exit drove buyout");
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(dot(query, phrase)).toBeGreaterThan(dot(query, scrambled));
  });

  it("weights a rare KB term above a ubiquitous one (IDF)", async () => {
    // "capital" is everywhere in the corpus (low IDF); "clawback" is rare (high
    // IDF). A query touching both should match the rare-term passage more
    // strongly — a uniform-weight (hash-v2) model would rank these two ties.
    const query = await embedder.embed("capital clawback");
    const common = await embedder.embed("capital");
    const rare = await embedder.embed("clawback");
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(dot(query, rare)).toBeGreaterThan(dot(query, common));
  });
});

describe("VoyageEmbedder", () => {
  const embedder = new VoyageEmbedder("vk-test", "voyage-3.5-lite");

  it("requests Matryoshka vectors at EMBED_DIM and normalizes the result", async () => {
    fetchMock.mockResolvedValue(voyageResponse([unitVector(EMBED_DIM, 3).map((v) => v * 2)]));
    const vec = await embedder.embed("what is the waterfall?", "query");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("voyageai.com");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toMatchObject({
      model: "voyage-3.5-lite",
      input: ["what is the waterfall?"],
      input_type: "query",
      output_dimension: EMBED_DIM,
    });
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer vk-test",
    );

    expect(vec).toHaveLength(EMBED_DIM);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
    // The vector-space identity is the (model, dim) pair.
    expect(embedder.model).toBe(`voyage-3.5-lite@${EMBED_DIM}`);
  });

  it("defaults input_type to document for ingestion", async () => {
    fetchMock.mockResolvedValue(voyageResponse([unitVector(EMBED_DIM, 0), unitVector(EMBED_DIM, 1)]));
    await embedder.embedBatch(["a", "b"]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.input_type).toBe("document");
    expect(body.input).toEqual(["a", "b"]);
  });

  it("throws on API failure instead of returning wrong-space vectors", async () => {
    fetchMock.mockResolvedValue(voyageResponse([], false, 500));
    await expect(embedder.embed("x")).rejects.toThrow(/500/);
  });

  it("throws on a count or dimension mismatch", async () => {
    fetchMock.mockResolvedValue(voyageResponse([unitVector(EMBED_DIM, 0)]));
    await expect(embedder.embedBatch(["a", "b"])).rejects.toThrow(/2 inputs/);

    fetchMock.mockResolvedValue(voyageResponse([[0.5, 0.5]]));
    await expect(embedder.embed("a")).rejects.toThrow(/dimension/);
  });
});

describe("getEmbedder", () => {
  it("is the keyless hash embedder without VOYAGE_API_KEY", () => {
    expect(getEmbedder().model).toBe("hash-v3");
  });

  it("is the Voyage embedder when the key is set, honoring the model override", () => {
    process.env.VOYAGE_API_KEY = "vk-test";
    expect(getEmbedder().model).toBe(`voyage-3.5-lite@${EMBED_DIM}`);
    process.env.VOYAGE_EMBED_MODEL = "voyage-3.5";
    expect(getEmbedder().model).toBe(`voyage-3.5@${EMBED_DIM}`);
  });
});

describe("toVectorLiteral", () => {
  it("serializes to the pgvector text literal", () => {
    expect(toVectorLiteral([0.1, -0.2, 0])).toBe("[0.1,-0.2,0]");
  });
});
