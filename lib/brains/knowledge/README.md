# Brain knowledge bases

Each Brain's full knowledge base (the BGI "Fund Master Brain" library) lives here
as the retrieval corpus that Brain reasons over. Files are named by `BrainKey`:

|          File           |                   Brain                   |
|-------------------------|-------------------------------------------|
| `earnest_fundmaker.md`  | Earnest Fundmaker                         |
| `automater_scrubber.md` | Automater / Scrubber                      |
| `executive_advisor.md`  | Executive Advisor / Investor Intelligence |
| `rainmaker.md`          | Rainmaker / High-Ticket Closer            |
| `deal_sourcer.md`       | Deal Sourcer / Acquisition Strategist     |
| `capital_connector.md`  | Capital Connector / Deal Maker            |
| `marketing_pr.md`       | Marketing / PR / Investor Materials       |
| `funnel_lead_gen.md`    | HTML Funnel / Lead Generation             |
| `seo_disrupter.md`      | SEO Disrupter / Unicorn Maker             |
| `legal_admin.md`        | Legal / Admin / Compliance Operations     |
| `event_curator.md`      | Private Event Curator                     |
| `capital_raiser.md`     | Capital Raiser                            |
| `investor_relations.md` | Investor Relations Strategist             |
| `disposition_desk.md`   | Disposition & Buyer-Match Desk            |
| `lender_network.md`     | Debt Capital Markets / Lender Network     |
| `deal_scout.md`         | Deal Scout / Discovery Engine             |
| `ma_integrator.md`      | M&A & Integration Intelligence            |

## Shared reference corpus (`reference/`)

Some knowledge is cross-cutting field material several Brains should reason over,
not a single Brain's corpus. Those docs live in [`reference/`](./reference/) and
are mapped to the Brains they serve in [`../reference.ts`](../reference.ts):

|             File             |                                            Folded into                                            |
|------------------------------|---------------------------------------------------------------------------------------------------|
| `private_equity_playbook.md` | Executive Advisor, Deal Sourcer, Capital Connector, Capital Raiser, Investor Relations, Rainmaker |
| `b2b_ai_agents_catalog.md`   | HTML Funnel / Lead Gen, SEO Disrupter, Marketing / PR, Automater / Scrubber, Earnest Fundmaker    |

Retrieval is keyed by `brain_key` (the `brain_kb_chunks` table + RPC filter on
it), so on ingest each reference doc is embedded under **each** Brain it is
mapped to (source `reference/<file>`). No schema change, and retrieval stays
per-Brain and unchanged. To add a reference doc: drop the `.md` in `reference/`
and add a `REFERENCE_DOCS` entry in [`../reference.ts`](../reference.ts).

The OS orchestration / command-layer docs (not per-Brain corpora) live in
[`../workflow/`](../workflow/): `master_workflow.md` and `workflow_instructor.md`.

The distilled execution profiles (role, when-to-use, outputs, tools, risk,
`systemPreamble`) still live in [`../catalog.ts`](../catalog.ts) — that keeps the
base prompt small. The full corpus here is the **retrieval** source: relevant
passages are folded into a Brain's prompt only when activated.

## How it is wired (now live)

1. **Corpus** — the `.md` files above are the per-Brain knowledge bases, plus the
   shared `reference/` docs folded into each Brain they are mapped to.
2. **Migration** — [`0024_brain_kb.sql`](../../../supabase/migrations/0024_brain_kb.sql)
   creates the shared `public.brain_kb_chunks` pgvector table (`vector(256)`),
   a permissive authenticated-read RLS policy (no write policy — seeded via the
   service role), and the `match_brain_kb_chunks` cosine-search RPC.
3. **Embedder** — [`../embed.ts`](../embed.ts) ships a DETERMINISTIC LOCAL
   embedder (`hash-v3`: feature-hashing over unigrams + bigrams, TF-IDF
   weighted, L2-normalized, dim 256). Zero cost, no API key. The IDF weights are
   precomputed over this corpus into [`../idf-table.json`](../idf-table.json)
   (built by [`../idf.ts`](../idf.ts)); regenerate after changing the corpus or
   tokenizer with `UPDATE_IDF=1 npx jest lib/brains/idf-table.test.ts`, which
   also fails CI if the committed table drifts from the code. A real embedder
   (Voyage/OpenAI) plugs in behind the same `Embedder` interface; keep
   `EMBED_DIM` and the migration's `vector(N)` in sync. Bumping the embedder
   `model` is a new vector space — re-run ingest/reembed so stored rows move to
   it (retrieval filters on `embedding_model`).
4. **Ingestion** — POST [`/api/brains/ingest`](../../../app/api/brains/ingest/route.ts)
   reads each Brain's own file plus its mapped `reference/` docs, chunks
   ([`chunkText`](../vector.ts)), embeds, and upserts into `brain_kb_chunks` via
   the service-role client. Idempotent (clears a brain's rows before inserting),
   so it is safe to re-run.
5. **Retrieval** — [`../pgvector.ts`](../pgvector.ts) embeds the query and calls
   the HYBRID RPC `match_brain_kb_chunks_hybrid` (migration `20260706120000`),
   which fuses the vector cosine ranking with a Postgres full-text ranking via
   Reciprocal Rank Fusion; it falls back to the pure-vector `match_brain_kb_chunks`
   RPC when the hybrid one is absent. [`../runtime.ts`](../runtime.ts) folds a
   couple of KB passages into every activation, in addition to the user's
   documents. If pgvector is unreachable or empty, it returns nothing and the
   keyword [`vectorStore`](../vector.ts) fallback keeps the demo working.

## Running ingestion

Apply migrations, then POST to the ingest route. With a shared secret:

```bash
# Set BRAIN_INGEST_SECRET in the server env, then:
curl -X POST https://<host>/api/brains/ingest \
  -H "Authorization: Bearer $BRAIN_INGEST_SECRET"
```

Or, signed in as an org writer, POST `/api/brains/ingest` from the app (the route
also accepts a session cookie from an owner/admin/member). The response reports
per-Brain chunk counts. Re-running is safe and idempotent.
