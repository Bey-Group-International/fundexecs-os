-- 0024_brain_kb.sql
-- The Brain knowledge-base corpus — a SHARED reference vector store.
--
-- Each Brain (Earnest Fundmaker, Deal Sourcer, Legal/Admin, …) reasons over its
-- own knowledge base (lib/brains/knowledge/<brain_key>.md). On ingest those files
-- are chunked, embedded, and upserted here; at activation time the runtime
-- cosine-searches this table (filtered to the active brain_key) and folds a couple
-- of grounding passages into the prompt.
--
-- This is reference data, NOT org-scoped: the same BGI Brain corpus serves every
-- organization. So tenancy differs from the rest of the domain — RLS allows ANY
-- authenticated user to read, and there is NO write policy: rows are seeded
-- server-side via the service role (which bypasses RLS), through the guarded
-- /api/brains/ingest entrypoint.
--
-- Embedding dimension is 256 to match the deterministic local embedder in
-- lib/brains/embed.ts (a zero-cost feature-hashing bag-of-words). A real embedder
-- (Voyage/OpenAI) plugs in behind the same Embedder interface; if you switch to a
-- different dimension, change vector(256) here to match.

create extension if not exists vector with schema extensions;

create table public.brain_kb_chunks (
  id           uuid primary key default extensions.gen_random_uuid(),
  brain_key    text not null,
  source       text not null,             -- the source file, e.g. deal_sourcer.md
  chunk_index  int  not null,
  content      text not null,
  embedding    extensions.vector(256),    -- matches lib/brains/embed.ts EMBED_DIM
  created_at   timestamptz not null default now()
);

create index brain_kb_chunks_brain_idx on public.brain_kb_chunks (brain_key);

-- Approximate-nearest-neighbour index for cosine search. Guarded so the migration
-- still applies on a Postgres/pgvector build where ivfflat isn't available — a
-- plain table (with a sequential cosine scan) is correct, just slower. We prefer
-- correctness over the ANN index.
do $$
begin
  create index brain_kb_chunks_embedding_idx
    on public.brain_kb_chunks
    using ivfflat (embedding extensions.vector_cosine_ops)
    with (lists = 100);
exception
  when undefined_object or feature_not_supported or others then
    raise notice 'skipping ivfflat ANN index on brain_kb_chunks (not available): %', sqlerrm;
end
$$;

alter table public.brain_kb_chunks enable row level security;

-- Shared reference corpus: world-readable to authenticated users, no write policy
-- (seeded only via the service role, which bypasses RLS).
create policy brain_kb_chunks_select on public.brain_kb_chunks
  for select to authenticated using (true);

-- Cosine retrieval RPC. Embeds happen in the app (the local embedder); this just
-- ranks the corpus for a given brain against a query embedding. SECURITY INVOKER
-- so it runs under the caller's RLS (the permissive SELECT above already allows
-- authenticated reads of this shared corpus).
create or replace function public.match_brain_kb_chunks(
  query_embedding extensions.vector(256),
  target_brain_key text,
  match_count int default 3
)
returns table (
  id uuid,
  brain_key text,
  source text,
  chunk_index int,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    c.id,
    c.brain_key,
    c.source,
    c.chunk_index,
    c.content,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.brain_kb_chunks c
  where c.brain_key = target_brain_key
    and c.embedding is not null
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;
