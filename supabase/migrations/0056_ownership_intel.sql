-- 0056_ownership_intel.sql
-- Ownership & Buyer Intelligence — modeling the M&A side of the market on top of
-- the Sourcing Intelligence catalog (0042) and the deals table. This is the
-- FundExecs answer to Mergr's acquisition-history + buyer-list + add-on discovery:
--
--   • acquisitions  — the deal-history graph: who bought whom, when, how, for how
--                     much. Rows can link back to catalog entities (acquirer/target
--                     entity_id) so ownership facts compound with discovery, but the
--                     names are always stored so a row stands alone.
--   • buyer_profiles — likely buyers (strategic / financial / PE / family office /
--                     search fund) with a thesis, sectors, geographies, a check
--                     band and an appetite score. Used to rank "who would buy this
--                     business?" and to discover bolt-on / add-on candidates.
--
-- Both are org-scoped with the same member-read / writer-write RLS as the rest of
-- the domain (mirrors dispatch_log / source_feedback). Idempotent DDL throughout
-- (create … if not exists / drop policy if exists then create) so re-application is
-- a no-op on a branch-preview DB and runs exactly once on a fresh DB.
--
-- NOTE: numbered 0055 (not 0051 as originally scoped) because 0051–0054 were taken
-- by sibling migrations on main by the time this branched.

-- ---------------------------------------------------------------------------
-- acquisitions — the deal-history / ownership graph
-- ---------------------------------------------------------------------------
create table if not exists public.acquisitions (
  id                  uuid primary key default extensions.gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  acquirer_name       text not null,
  target_name         text not null,
  -- optional links into the sourcing catalog (0042) so ownership facts compound
  -- with semantic discovery; nullable + no FK so a row never depends on the catalog.
  acquirer_entity_id  uuid,
  target_entity_id    uuid,
  announced_on        date,
  price_amount        numeric,
  currency            text not null default 'USD',
  -- 'majority' | 'minority' | 'add_on' | 'merger' | 'asset' | 'recap'
  structure           text,
  sector              text,
  source_url          text,
  metadata            jsonb not null default '{}'::jsonb,
  created_by          uuid references public.principals (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists acquisitions_org_idx on public.acquisitions (organization_id);
create index if not exists acquisitions_org_acquirer_idx on public.acquisitions (organization_id, lower(acquirer_name));
create index if not exists acquisitions_org_target_idx on public.acquisitions (organization_id, lower(target_name));
create index if not exists acquisitions_org_sector_idx on public.acquisitions (organization_id, sector);

alter table public.acquisitions enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists acquisitions_select on public.acquisitions;
create policy acquisitions_select on public.acquisitions
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists acquisitions_write on public.acquisitions;
create policy acquisitions_write on public.acquisitions
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- ---------------------------------------------------------------------------
-- buyer_profiles — likely buyers for ranking + add-on discovery
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_profiles (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  -- optional link into the sourcing catalog (0042); nullable + no FK by design.
  entity_id       uuid,
  -- 'strategic' | 'financial' | 'pe' | 'family_office' | 'search_fund'
  buyer_type      text,
  thesis          text,
  sectors         text[] not null default '{}',
  geographies     text[] not null default '{}',
  check_min       numeric,
  check_max       numeric,
  -- 0–100 acquisitiveness / appetite signal used in fit scoring.
  appetite        integer,
  source_url      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists buyer_profiles_org_idx on public.buyer_profiles (organization_id);
create index if not exists buyer_profiles_org_type_idx on public.buyer_profiles (organization_id, buyer_type);
create index if not exists buyer_profiles_org_name_idx on public.buyer_profiles (organization_id, lower(name));

alter table public.buyer_profiles enable row level security;

drop policy if exists buyer_profiles_select on public.buyer_profiles;
create policy buyer_profiles_select on public.buyer_profiles
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists buyer_profiles_write on public.buyer_profiles;
create policy buyer_profiles_write on public.buyer_profiles
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
