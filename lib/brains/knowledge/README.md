# Brain knowledge bases

Each Brain's full knowledge base (the BGI "Fund Master Brain" library — Earnest
Fundmaker, Deal Sourcer, Capital Connector, Legal/Admin, etc.) lives here as the
retrieval corpus a Brain reasons over.

Today the Brain layer ships **distilled execution profiles** in
[`../catalog.ts`](../catalog.ts): each Brain's role, when-to-use, outputs, tools,
risk profile, and a short `systemPreamble` hand-written from its KB. That keeps
prompts small and cost near-zero.

## Plugging in the full corpus (later)

1. Drop each Brain's knowledge `.md` into this folder, named by `BrainKey`
   (e.g. `deal_sourcer.md`, `legal_admin.md`).
2. On ingest, chunk + embed each file into the vector store (swap the keyword
   `vectorStore` in [`../vector.ts`](../vector.ts) for a pgvector/Supabase
   implementation behind the same `VectorStore` interface).
3. In [`../runtime.ts`](../runtime.ts), retrieve from the activated Brain's own
   KB (in addition to the user's documents) so each Brain answers in its full,
   grounded voice.

No Brain logic changes — only the retrieval source.
