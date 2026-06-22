-- 0042_sourcing_entities.sql
-- The Sourcing Intelligence catalog — a first-party, embedded entity store that
-- powers semantic discovery and lookalike search (the Grata/Inven/Cyndx core).
--
-- Each row is a market entity the firm has discovered or knows about: a company /
-- acquisition target, an LP/allocator, a fund, an advisor, a lender, a provider.
-- Unlike the pipeline tables (investors/deals/…), which are the operator's active
-- working set, this is the broader *universe* the operator searches over. Rows
-- accrue from three sources (provenance): the operator's own pipeline (mirrored
-- in), AI/web discovery, and — later — third-party providers behind an adapter.
--
-- `embedding` is a pgvector column at dim 256 to match lib/brains/embed.ts (the
-- deterministic, zero-cost local embedder). Cosine search runs through the
-- match_sourcing_entities RPC. A real embedder (Voyage/OpenAI) plugs in behind
-- the same Embedder seam; if you change the dimension, change vector(256) here to
-- match (exactly as documented for brain_kb_chunks in 0024).
--
-- Org-scoped (each org builds its own catalog), with the same member-read /
-- writer-write RLS as the rest of the domain.

create extension if not exists vector with schema extensions;

create table if not exists public.sourcing_entities (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- 'company' | 'investor' | 'fund' | 'advisor' | 'lender' | 'provider'
  kind            text not null,
  name            text not null,
  domain          text,
  -- the firmographic blurb that gets embedded (what the entity is + why it fits).
  description     text,
  -- sector / type tags used for faceting + the deterministic lexical fallback.
  categories      text[] not null default '{}',
  geography       text,
  -- firmographics + signal snapshots (size, check band, AUM, fitScore, …) and the
  -- hook for future signals/ownership clusters — kept open so they need no DDL.
  metadata        jsonb not null default '{}'::jsonb,
  -- 'manual' | 'ai' | 'web' | 'pipeline' | '<provider>' — adapter-ready lineage.
  provenance      text not null default 'manual',
  source_url      text,
  embedding       extensions.vector(256),
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sourcing_entities_org_idx on public.sourcing_entities (organization_id);
create index if not exists sourcing_entities_org_kind_idx on public.sourcing_entities (organization_id, kind);
-- De-dupe / upsert key: one row per (org, kind, lower(name)).
create unique index if not exists sourcing_entities_org_kind_name_idx
  on public.sourcing_entities (organization_id, kind, lower(name));

-- Approximate-nearest-neighbour index for cosine search, guarded so the migration
-- still applies where ivfflat isn't available (a sequential scan is correct, just
-- slower) — same approach as brain_kb_chunks (0024).
do $$
begin
  create index sourcing_entities_embedding_idx
    on public.sourcing_entities
    using ivfflat (embedding extensions.vector_cosine_ops)
    with (lists = 100);
exception
  when undefined_object or feature_not_supported or others then
    raise notice 'skipping ivfflat ANN index on sourcing_entities (not available): %', sqlerrm;
end
$$;

alter table public.sourcing_entities enable row level security;

drop policy if exists sourcing_entities_select on public.sourcing_entities;
create policy sourcing_entities_select on public.sourcing_entities
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists sourcing_entities_write on public.sourcing_entities;
create policy sourcing_entities_write on public.sourcing_entities
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- Cosine retrieval RPC. The app embeds the query (lib/brains/embed.ts) and passes
-- the vector literal; this ranks the org's catalog, optionally filtered by kind
-- and excluding a row (for lookalike search). SECURITY INVOKER so it runs under
-- the caller's RLS (the org-scoped SELECT above).
create or replace function public.match_sourcing_entities(
  query_embedding extensions.vector(256),
  target_org uuid,
  match_count int default 8,
  filter_kind text default null,
  exclude_id uuid default null
)
returns table (
  id uuid,
  kind text,
  name text,
  domain text,
  description text,
  categories text[],
  geography text,
  metadata jsonb,
  source_url text,
  provenance text,
  similarity float
)
language sql
stable
as $$
  select
    e.id,
    e.kind,
    e.name,
    e.domain,
    e.description,
    e.categories,
    e.geography,
    e.metadata,
    e.source_url,
    e.provenance,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.sourcing_entities e
  where e.organization_id = target_org
    and e.embedding is not null
    and (filter_kind is null or e.kind = filter_kind)
    and (exclude_id is null or e.id <> exclude_id)
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
