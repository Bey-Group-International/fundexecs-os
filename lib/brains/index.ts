// The Brain layer — public surface.
// Workflows orchestrate; Brains execute. Activate a Brain with a goal and it
// decides how to achieve it, logging an audit trail to brain_runs.
export * from "@/lib/brains/types";
export { BRAINS, BRAIN_BY_KEY, getBrain } from "@/lib/brains/catalog";
export { activateBrain } from "@/lib/brains/runtime";
export { brainsLive } from "@/lib/brains/llm";
export { vectorStore, chunkText } from "@/lib/brains/vector";
export { embedder, HashingEmbedder, EMBED_DIM, toVectorLiteral } from "@/lib/brains/embed";
export type { Embedder } from "@/lib/brains/embed";
export { retrieveBrainKb } from "@/lib/brains/pgvector";
