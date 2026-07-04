-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
create table if not exists public.stakeholders (
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
do $$ begin
  create index if not exists stakeholders_org_idx on public.stakeholders (organization_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  drop trigger if exists stakeholders_set_updated_at on public.stakeholders;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  create trigger stakeholders_set_updated_at
  before update on public.stakeholders
  for each row execute function public.set_updated_at();
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

create table if not exists public.share_classes (
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
do $$ begin
  create index if not exists share_classes_entity_idx on public.share_classes (entity_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  drop trigger if exists share_classes_set_updated_at on public.share_classes;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  create trigger share_classes_set_updated_at
  before update on public.share_classes
  for each row execute function public.set_updated_at();
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

create table if not exists public.equity_holdings (
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
do $$ begin
  create index if not exists equity_holdings_entity_idx on public.equity_holdings (entity_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  create index if not exists equity_holdings_stakeholder_idx on public.equity_holdings (stakeholder_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  drop trigger if exists equity_holdings_set_updated_at on public.equity_holdings;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  create trigger equity_holdings_set_updated_at
  before update on public.equity_holdings
  for each row execute function public.set_updated_at();
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  alter table public.stakeholders     enable row level security;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  alter table public.share_classes    enable row level security;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  alter table public.equity_holdings  enable row level security;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

drop policy if exists stakeholders_select on public.stakeholders;
do $$ begin
  create policy stakeholders_select on public.stakeholders
  for select using (organization_id in (select public.current_principal_org_ids()));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
drop policy if exists stakeholders_write on public.stakeholders;
do $$ begin
  create policy stakeholders_write on public.stakeholders
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

drop policy if exists share_classes_select on public.share_classes;
do $$ begin
  create policy share_classes_select on public.share_classes
  for select using (organization_id in (select public.current_principal_org_ids()));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
drop policy if exists share_classes_write on public.share_classes;
do $$ begin
  create policy share_classes_write on public.share_classes
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

drop policy if exists equity_holdings_select on public.equity_holdings;
do $$ begin
  create policy equity_holdings_select on public.equity_holdings
  for select using (organization_id in (select public.current_principal_org_ids()));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
drop policy if exists equity_holdings_write on public.equity_holdings;
do $$ begin
  create policy equity_holdings_write on public.equity_holdings
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;;
