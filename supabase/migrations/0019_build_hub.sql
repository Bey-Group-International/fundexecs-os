-- 0019_build_hub.sql
-- Build hub data: legal entities (Entity module) and brand fields (Brand
-- module). The other Build modules (Thesis, Track Record, Team, Profile) are
-- already backed by existing tables.

-- Brand: extend the org's existing identity (brand_color, logo_url, description
-- already exist) with the rest of a brand kit.
alter table public.organizations add column tagline text;
alter table public.organizations add column brand_voice text;
alter table public.organizations add column brand_palette text[] not null default '{}';

-- Entity: the legal structure — GP/management co, funds, SPVs, holdcos — with an
-- optional parent for org charts.
create table public.entities (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  name              text not null,
  entity_type       text not null default 'spv',  -- gp | management_co | fund | spv | holdco | other
  jurisdiction      text,
  parent_entity_id  uuid references public.entities (id) on delete set null,
  formation_date    date,
  notes             text,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index entities_org_idx on public.entities (organization_id, created_at desc);
create index entities_parent_idx on public.entities (parent_entity_id);

create trigger entities_set_updated_at
  before update on public.entities
  for each row execute function public.set_updated_at();

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.entities enable row level security;

create policy entities_select on public.entities
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy entities_write on public.entities
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
