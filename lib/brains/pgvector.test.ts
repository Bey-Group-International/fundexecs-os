// Coverage for the Brain KB pgvector retrieval seam. The contracts:
//   - prefer the hybrid (vector + full-text RRF) RPC, passing the query text
//   - fall back to the pure-vector RPC when the hybrid RPC is absent/errors
//   - map rows to RetrievedChunk and degrade to [] on total failure

import { retrieveBrainKb } from "./pgvector";

type RpcResult = { data: unknown; error: unknown };

// Minimal Supabase stub: a jest.fn() for .rpc we can program per-call.
function makeSupabase(rpc: jest.Mock) {
  return { rpc } as unknown as Parameters<typeof retrieveBrainKb>[0];
}

const rows = [
  { id: "1", brain_key: "acq", source: "cheatsheet.md", chunk_index: 0, content: "EBITDA multiples", similarity: 0.9 },
];

beforeEach(() => {
  delete process.env.VOYAGE_API_KEY; // ensure the native hash embedder is used
});

describe("retrieveBrainKb", () => {
  it("uses the hybrid RPC and passes query_text", async () => {
    const rpc = jest.fn(async (fn: string, _args?: Record<string, unknown>): Promise<RpcResult> => {
      if (fn === "match_brain_kb_chunks_hybrid") return { data: rows, error: null };
      return { data: null, error: new Error("should not be called") };
    });

    const out = await retrieveBrainKb(makeSupabase(rpc), "acq", "what are typical EBITDA multiples?", 2);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("match_brain_kb_chunks_hybrid");
    expect(args).toMatchObject({
      target_brain_key: "acq",
      query_text: "what are typical EBITDA multiples?",
      match_count: 2,
    });
    expect(out).toEqual([{ source: "cheatsheet.md", text: "EBITDA multiples", score: 0.9 }]);
  });

  it("falls back to the pure-vector RPC when the hybrid RPC errors", async () => {
    const rpc = jest.fn(async (fn: string, _args?: Record<string, unknown>): Promise<RpcResult> => {
      if (fn === "match_brain_kb_chunks_hybrid") return { data: null, error: new Error("function does not exist") };
      if (fn === "match_brain_kb_chunks") return { data: rows, error: null };
      return { data: null, error: new Error("unexpected") };
    });

    const out = await retrieveBrainKb(makeSupabase(rpc), "acq", "EBITDA", 2);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][0]).toBe("match_brain_kb_chunks");
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("cheatsheet.md");
  });

  it("returns [] when both RPCs fail", async () => {
    const rpc = jest.fn(async (): Promise<RpcResult> => ({ data: null, error: new Error("boom") }));
    const out = await retrieveBrainKb(makeSupabase(rpc), "acq", "EBITDA", 2);
    expect(out).toEqual([]);
  });
});
