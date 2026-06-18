-- 0003_build_hub.sql
-- Build hub modules beyond identity: Thesis and Track Record.
-- (Profile / Brand / Entity live on `organizations`; Team is organization_members.)

-- ---------------------------------------------------------------------------
-- investment_theses — the fund/firm's strategy statement (Build > Thesis).
-- ---------------------------------------------------------------------------
create table public.investment_theses (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title           text not null,
  summary         text,
  asset_classes   text[] not null default '{}',
  geographies     text[] not null default '{}',
  check_size_min  numeric(18, 2),
  check_size_max  numeric(18, 2),
  target_irr      numeric(6, 4),               -- e.g. 0.1800 == 18%
  target_moic     numeric(6, 3),               -- multiple on invested capital
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index investment_theses_org_idx on public.investment_theses (organization_id);

create trigger investment_theses_set_updated_at
  before update on public.investment_theses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- track_records — realized / unrealized deal history (Build > Track Record).
-- ---------------------------------------------------------------------------
create table public.track_records (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_name       text not null,
  asset_class     text,
  vintage_year    int,
  invested_amount numeric(18, 2),
  realized_value  numeric(18, 2),
  unrealized_value numeric(18, 2),
  gross_irr       numeric(6, 4),
  gross_moic      numeric(6, 3),
  is_realized     boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index track_records_org_idx on public.track_records (organization_id);

create trigger track_records_set_updated_at
  before update on public.track_records
  for each row execute function public.set_updated_at();
