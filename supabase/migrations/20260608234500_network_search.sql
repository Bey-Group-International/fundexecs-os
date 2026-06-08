-- =====================================================================
-- LP & Partner search — Phase 1: hybrid retrieval over your own network.
--
-- Additive + idempotent. Makes contacts / service_providers /
-- capital_providers searchable by meaning AND keyword, with structured
-- filters, scoped to the caller's org. Embeddings are produced elsewhere
-- (Voyage, via the intelligence cron / a refresh action); this migration only
-- adds the columns, indexes, and the read RPC. When a row has no embedding the
-- semantic term is simply null and keyword matching still applies — never-block.
-- =====================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Embedding columns (semantic-search source) + hnsw cosine indexes.
-- ---------------------------------------------------------------------

alter table public.contacts add column if not exists embedding extensions.vector(1024);
alter table public.service_providers add column if not exists embedding extensions.vector(1024);
alter table public.capital_providers add column if not exists embedding extensions.vector(1024);

create index if not exists contacts_embedding_idx
  on public.contacts using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists service_providers_embedding_idx
  on public.service_providers using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists capital_providers_embedding_idx
  on public.capital_providers using hnsw (embedding extensions.vector_cosine_ops);

grant update (embedding) on public.contacts to service_role;
grant update (embedding) on public.service_providers to service_role;
grant update (embedding) on public.capital_providers to service_role;

-- ---------------------------------------------------------------------
-- 2. Unified network search.
--
-- Returns ranked rows across the three sources, scoped to the caller's org.
-- Semantic similarity (pgvector cosine) when both the query and the row carry
-- an embedding; keyword ILIKE always applies; optional structured filters
-- (capital type, check-size band, service category). Each row carries an
-- `already_connected` flag so the UI can badge people/firms already in your
-- network and offer a warm intro instead of a cold one.
-- ---------------------------------------------------------------------

create or replace function public.search_network(
  _org_id uuid,
  _query_text text default null,
  _query_embedding extensions.vector(1024) default null,
  _kinds text[] default array['contact', 'service_provider', 'capital_provider'],
  _capital_types text[] default null,
  _category text default null,
  _check_min numeric default null,
  _check_max numeric default null,
  _limit integer default 40
)
returns table (
  kind text,
  id uuid,
  name text,
  subtitle text,
  similarity real,
  already_connected boolean,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _q text := nullif(btrim(coalesce(_query_text, '')), '');
begin
  if _org_id is null then
    raise exception 'org_id is required' using errcode = '22023';
  end if;

  -- Authz: service_role (server jobs) or an active member of the org.
  if coalesce((select auth.role()), '') <> 'service_role'
     and not exists (
       select 1 from public.org_members om
       where om.org_id = _org_id and om.user_id = (select auth.uid()) and om.status = 'active'
     ) then
    raise exception 'not authorized for this org' using errcode = '42501';
  end if;

  return query
  with results as (
    -- Contacts (they are, by definition, already in your network).
    select
      'contact'::text as kind,
      c.id,
      coalesce(nullif(btrim(c.full_name), ''), '(unnamed contact)') as name,
      nullif(concat_ws(' · ', nullif(btrim(coalesce(c.title, '')), ''), nullif(btrim(coalesce(c.company, '')), '')), '') as subtitle,
      case
        when _query_embedding is not null and c.embedding is not null
          then (1 - (c.embedding operator(extensions.<=>) _query_embedding))::real
        else null
      end as similarity,
      true as already_connected,
      jsonb_build_object('company', c.company, 'title', c.title, 'email', c.primary_email) as metadata
    from public.contacts c
    where c.org_id = _org_id
      and 'contact' = any (_kinds)
      and (
        _q is null
        or c.full_name ilike '%' || _q || '%'
        or c.company ilike '%' || _q || '%'
        or c.title ilike '%' || _q || '%'
        or (_query_embedding is not null and c.embedding is not null
            and (1 - (c.embedding operator(extensions.<=>) _query_embedding)) > 0.2)
      )

    union all

    -- Service providers.
    select
      'service_provider'::text,
      s.id,
      s.name,
      nullif(btrim(coalesce(s.category, '')), ''),
      case
        when _query_embedding is not null and s.embedding is not null
          then (1 - (s.embedding operator(extensions.<=>) _query_embedding))::real
        else null
      end,
      exists (
        select 1 from public.contacts cc
        where cc.org_id = _org_id
          and (lower(coalesce(cc.company, '')) = lower(s.name) or cc.company ilike '%' || s.name || '%')
      ),
      jsonb_build_object('category', s.category, 'status', s.status, 'capabilities', s.capabilities)
    from public.service_providers s
    where s.org_id = _org_id
      and 'service_provider' = any (_kinds)
      and (_category is null or s.category = _category)
      and (
        _q is null
        or s.name ilike '%' || _q || '%'
        or s.category ilike '%' || _q || '%'
        or (_query_embedding is not null and s.embedding is not null
            and (1 - (s.embedding operator(extensions.<=>) _query_embedding)) > 0.2)
      )

    union all

    -- Capital providers (LPs, family offices, fund-of-funds, ...).
    select
      'capital_provider'::text,
      cp.id,
      cp.name,
      nullif(array_to_string(cp.capital_types, ', '), ''),
      case
        when _query_embedding is not null and cp.embedding is not null
          then (1 - (cp.embedding operator(extensions.<=>) _query_embedding))::real
        else null
      end,
      exists (
        select 1 from public.contacts cc
        where cc.org_id = _org_id
          and (lower(coalesce(cc.company, '')) = lower(cp.name) or cc.company ilike '%' || cp.name || '%')
      ),
      jsonb_build_object(
        'capital_types', cp.capital_types,
        'check_size_min', cp.check_size_min,
        'check_size_max', cp.check_size_max,
        'status', cp.status
      )
    from public.capital_providers cp
    where cp.org_id = _org_id
      and 'capital_provider' = any (_kinds)
      and (_capital_types is null or cp.capital_types && _capital_types)
      and (_check_min is null or cp.check_size_max is null or cp.check_size_max >= _check_min)
      and (_check_max is null or cp.check_size_min is null or cp.check_size_min <= _check_max)
      and (
        _q is null
        or cp.name ilike '%' || _q || '%'
        or array_to_string(cp.capital_types, ' ') ilike '%' || _q || '%'
        or (_query_embedding is not null and cp.embedding is not null
            and (1 - (cp.embedding operator(extensions.<=>) _query_embedding)) > 0.2)
      )
  )
  select r.kind, r.id, r.name, r.subtitle, r.similarity, r.already_connected, r.metadata
  from results r
  order by coalesce(r.similarity, 0) desc, r.name asc
  limit greatest(1, least(coalesce(_limit, 40), 200));
end;
$$;

revoke all on function public.search_network(uuid, text, extensions.vector, text[], text[], text, numeric, numeric, integer)
  from public, anon;
grant execute on function public.search_network(uuid, text, extensions.vector, text[], text[], text, numeric, numeric, integer)
  to authenticated, service_role;
