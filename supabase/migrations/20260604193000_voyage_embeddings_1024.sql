-- Switch knowledge embeddings to Voyage dimensionality (1024). Table is empty,
-- so the column type change is safe. Recreate the HNSW index and the
-- match_knowledge_chunks RPC for the new dimension.
drop index if exists public.knowledge_chunks_embedding_idx;
alter table public.knowledge_chunks alter column embedding type extensions.vector(1024);
create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1024),
  match_count int default 8,
  _org_id uuid default null
)
returns table (id uuid, document_id uuid, brain_id uuid, content text, similarity double precision)
language sql stable security definer set search_path = public, extensions as $$
  select c.id, c.document_id, c.brain_id, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks c
  where c.embedding is not null
    and (c.org_id is null or private.is_org_member(c.org_id))
    and (_org_id is null or c.org_id is null or c.org_id = _org_id)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
revoke all on function public.match_knowledge_chunks(extensions.vector, int, uuid) from public, anon;
grant execute on function public.match_knowledge_chunks(extensions.vector, int, uuid) to authenticated;
