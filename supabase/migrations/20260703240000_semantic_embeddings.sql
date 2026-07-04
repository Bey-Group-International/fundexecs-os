-- 20260703240000_semantic_embeddings.sql
-- Real semantic retrieval behind the Embedder seam (lib/brains/embed.ts).
--
-- The Voyage embedder writes 256-dim Matryoshka vectors into the SAME
-- vector(256) column the hash embedder uses — but the two vector spaces are
-- not comparable, so every row must say which space its embedding lives in
-- and retrieval must only rank rows in the query's space. Rows left in a
-- stale space are re-embedded by the backfill route (app/api/brains/reembed);
-- until then they are excluded from matches rather than silently mis-ranked.

-- 1. Which vector space each chunk's embedding was produced in. Existing rows
-- were all written by the local hash embedder.
alter table public.brain_kb_chunks
  add column if not exists embedding_model text not null default 'hash-v1';

-- Backfill scans look for rows outside the active space.
create index if not exists brain_kb_chunks_embedding_model_idx
  on public.brain_kb_chunks (embedding_model);

-- 2. Retrieval filters to the query's vector space. `query_model` defaults to
-- 'hash-v1' so any not-yet-updated caller keeps its exact previous behavior.
create or replace function public.match_brain_kb_chunks(
  query_embedding extensions.vector(256),
  target_brain_key text,
  match_count int default 3,
  query_model text default 'hash-v1'
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
    and c.embedding_model = query_model
  order by c.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;
