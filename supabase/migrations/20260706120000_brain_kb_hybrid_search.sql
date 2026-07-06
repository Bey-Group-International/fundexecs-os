-- 20260706120000_brain_kb_hybrid_search.sql
-- Native hybrid retrieval for the Brain knowledge base.
--
-- The keyless hash embedder (lib/brains/embed.ts) is lexical-leaning: it grounds
-- a Brain in its own corpus but has weak semantic separation. Pure cosine search
-- can therefore miss chunks that a human would consider an obvious keyword match
-- (a firm name, "EBITDA", "leveraged buyout"). This migration adds a full-text
-- signal alongside the vector signal and FUSES the two with Reciprocal Rank
-- Fusion (RRF) — a standard, parameter-light way to combine rankings that needs
-- no score calibration between the two spaces. Fully native: no external service.
--
-- Additive and safe: the existing match_brain_kb_chunks (pure vector) RPC is left
-- in place, so app code that hasn't switched keeps working, and retrieveBrainKb
-- falls back to it if this hybrid RPC is absent.

-- 1. A generated tsvector of each chunk's text, plus a GIN index for fast FTS.
alter table public.brain_kb_chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists brain_kb_chunks_tsv_idx
  on public.brain_kb_chunks using gin (content_tsv);

-- 2. Hybrid retrieval RPC. Ranks the brain's chunks by vector cosine AND by
-- full-text ts_rank independently, then fuses the two ranks with RRF
-- (score = sum of 1/(rrf_k + rank) across the lists a row appears in) and returns
-- the top match_count. `similarity` carries the cosine value (0 for lexical-only
-- hits) so callers keep a meaningful score. SECURITY INVOKER — runs under the
-- caller's RLS, same as match_brain_kb_chunks.
create or replace function public.match_brain_kb_chunks_hybrid(
  query_embedding extensions.vector(256),
  target_brain_key text,
  query_text text,
  match_count int default 3,
  query_model text default 'hash-v2',
  rrf_k int default 60,
  candidate_count int default 40
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
  with q as (
    -- websearch_to_tsquery tolerates arbitrary user text; the guard makes an
    -- empty/whitespace query match nothing so we degrade to pure vector search.
    select websearch_to_tsquery('english', coalesce(nullif(trim(query_text), ''), 'zzzznomatchzzzz')) as tsq
  ),
  base as (
    select c.id, c.brain_key, c.source, c.chunk_index, c.content, c.embedding, c.content_tsv
    from public.brain_kb_chunks c
    where c.brain_key = target_brain_key
      and c.embedding is not null
      and c.embedding_model = query_model
  ),
  vector_ranked as (
    select
      id,
      row_number() over (order by embedding OPERATOR(extensions.<=>) query_embedding) as rnk,
      1 - (embedding OPERATOR(extensions.<=>) query_embedding) as cos
    from base
    order by embedding OPERATOR(extensions.<=>) query_embedding
    limit candidate_count
  ),
  lexical_ranked as (
    select
      b.id,
      row_number() over (order by ts_rank(b.content_tsv, q.tsq) desc) as rnk
    from base b, q
    where b.content_tsv @@ q.tsq
    order by ts_rank(b.content_tsv, q.tsq) desc
    limit candidate_count
  ),
  fused as (
    select
      coalesce(v.id, l.id) as id,
      coalesce(1.0 / (rrf_k + v.rnk), 0) + coalesce(1.0 / (rrf_k + l.rnk), 0) as rrf,
      v.cos as cos
    from vector_ranked v
    full outer join lexical_ranked l on v.id = l.id
  )
  select
    b.id,
    b.brain_key,
    b.source,
    b.chunk_index,
    b.content,
    coalesce(f.cos, 0)::float as similarity
  from fused f
  join base b on b.id = f.id
  order by f.rrf desc
  limit greatest(match_count, 1);
$$;
