-- 0006_graph.sql
-- The Relationship graph as polymorphic edges. The Deal and Capital graphs are
-- expressed primarily through concrete foreign keys (deals.fund_id,
-- commitments.fund_id/investor_id, assets.deal_id, etc.); this table captures
-- the softer "who knows whom / who is connected to what" edges that don't fit a
-- single FK — and can also annotate deal/capital connections with metadata.

-- A node is identified by (entity_type, entity_id). entity_type is a free-form
-- key matching a table name (e.g. 'investor', 'deal', 'principal',
-- 'organization', 'fund', 'asset') so the graph can span every domain object
-- without a fan of nullable FK columns.
create table public.relationships (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  graph            graph_kind not null default 'relationship',
  from_entity_type text not null,
  from_entity_id   uuid not null,
  to_entity_type   text not null,
  to_entity_id     uuid not null,
  relation         text not null,              -- 'introduced_by', 'invested_in', 'advises'...
  strength         numeric(4, 3),              -- 0..1 confidence / closeness
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- prevent exact duplicate edges
  unique (organization_id, graph, from_entity_type, from_entity_id,
          to_entity_type, to_entity_id, relation)
);

create index relationships_org_idx on public.relationships (organization_id);
create index relationships_from_idx on public.relationships (from_entity_type, from_entity_id);
create index relationships_to_idx on public.relationships (to_entity_type, to_entity_id);
create index relationships_graph_idx on public.relationships (organization_id, graph);

create trigger relationships_set_updated_at
  before update on public.relationships
  for each row execute function public.set_updated_at();
