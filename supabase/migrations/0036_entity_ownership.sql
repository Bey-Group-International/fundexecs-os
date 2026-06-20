-- 0036_entity_ownership.sql
-- Build-hub entity ownership — a Carta/AngelList-style cap table for the firm's
-- OWN vehicles (who owns the GP, management company, funds, and SPVs): partner
-- equity splits and sponsor stakes. Distinct from the Execute-hub LP cap table,
-- which rolls up commitments into fund ownership. Stakeholders + share classes +
-- holdings against public.entities.

create table public.stakeholders (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  kind            text not null default 'person'
                    check (kind in ('person', 'entity', 'investor', 'fund', 'pool', 'other')),
  email           text,
  notes           text,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index stakeholders_org_idx on public.stakeholders (organization_id);

create trigger stakeholders_set_updated_at
  before update on public.stakeholders
  for each row execute function public.set_updated_at();

create table public.share_classes (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_id       uuid not null references public.entities (id) on delete cascade,
  name            text not null,
  kind            text not null default 'common'
                    check (kind in ('common', 'preferred', 'lp_interest', 'gp_interest',
                                    'membership', 'option', 'safe', 'note', 'other')),
  authorized_units numeric,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index share_classes_entity_idx on public.share_classes (entity_id);

create trigger share_classes_set_updated_at
  before update on public.share_classes
  for each row execute function public.set_updated_at();

create table public.equity_holdings (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_id       uuid not null references public.entities (id) on delete cascade,
  stakeholder_id  uuid not null references public.stakeholders (id) on delete cascade,
  share_class_id  uuid references public.share_classes (id) on delete set null,
  units           numeric,
  ownership_pct   numeric,
  invested_amount numeric,
  notes           text,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index equity_holdings_entity_idx on public.equity_holdings (entity_id);
create index equity_holdings_stakeholder_idx on public.equity_holdings (stakeholder_id);

create trigger equity_holdings_set_updated_at
  before update on public.equity_holdings
  for each row execute function public.set_updated_at();

alter table public.stakeholders     enable row level security;
alter table public.share_classes    enable row level security;
alter table public.equity_holdings  enable row level security;

-- member-read / writer-write org tenancy (the team co-edits), as elsewhere.
create policy stakeholders_select on public.stakeholders
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy stakeholders_write on public.stakeholders
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy share_classes_select on public.share_classes
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy share_classes_write on public.share_classes
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy equity_holdings_select on public.equity_holdings
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy equity_holdings_write on public.equity_holdings
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
