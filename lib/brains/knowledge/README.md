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

The OS orchestration / command-layer docs (not per-Brain corpora) live in
[`../workflow/`](../workflow/): `master_workflow.md` and `workflow_instructor.md`.

The distilled execution profiles (role, when-to-use, outputs, tools, risk,
`systemPreamble`) still live in [`../catalog.ts`](../catalog.ts) — that keeps the
base prompt small. The full corpus here is the **retrieval** source: relevant
passages are folded into a Brain's prompt only when activated.

## How it is wired (now live)

1. **Corpus** — the `.md` files above are the per-Brain knowledge bases.
2. **Migration** — [`0024_brain_kb.sql`](../../../supabase/migrations/0024_brain_kb.sql)
   creates the shared `public.brain_kb_chunks` pgvector table (`vector(256)`),
   a permissive authenticated-read RLS policy (no write policy — seeded via the
   service role), and the `match_brain_kb_chunks` cosine-search RPC.
3. **Embedder** — [`../embed.ts`](../embed.ts) ships a DETERMINISTIC LOCAL
   embedder (feature-hashing bag-of-words, L2-normalized, dim 256). Zero cost,
   no API key. A real embedder (Voyage/OpenAI) plugs in behind the same
   `Embedder` interface; keep `EMBED_DIM` and the migration's `vector(N)` in sync.
4. **Ingestion** — POST [`/api/brains/ingest`](../../../app/api/brains/ingest/route.ts)
   reads these files, chunks ([`chunkText`](../vector.ts)), embeds, and upserts
   into `brain_kb_chunks` via the service-role client. Idempotent (clears a
   brain's rows before inserting), so it is safe to re-run.
5. **Retrieval** — [`../pgvector.ts`](../pgvector.ts) embeds the query and calls
   the RPC; [`../runtime.ts`](../runtime.ts) folds a couple of KB passages into
   every activation, in addition to the user's documents. If pgvector is
   unreachable or empty, it returns nothing and the keyword
   [`vectorStore`](../vector.ts) fallback keeps the demo working.

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
