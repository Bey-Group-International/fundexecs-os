-- 0004_capital.sql
-- Capital graph nodes + movements. Investors (LPs, lenders, family offices,
-- banks), the funds/SPVs they back, their commitments, and capital events.

-- ---------------------------------------------------------------------------
-- investors — Capital graph nodes (Source > LP Pipeline / Debt / Partners).
-- ---------------------------------------------------------------------------
create table public.investors (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  investor_type   investor_type not null default 'lp',
  contact_name    text,
  contact_email   text,
  jurisdiction    text,
  aum             numeric(18, 2),              -- assets under management
  typical_check_min numeric(18, 2),
  typical_check_max numeric(18, 2),
  notes           text,
  -- lightweight pipeline state for Source hub (e.g. prospect/committed/closed)
  pipeline_stage  text not null default 'prospect',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index investors_org_idx on public.investors (organization_id);
create index investors_name_trgm_idx on public.investors using gin (name extensions.gin_trgm_ops);

create trigger investors_set_updated_at
  before update on public.investors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- funds — pooled vehicles: funds, SPVs, co-invests, separate accounts
-- (Deal graph nodes; the entity LPs commit into).
-- ---------------------------------------------------------------------------
create table public.funds (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  fund_type       fund_type not null default 'fund',
  vintage_year    int,
  target_size     numeric(18, 2),
  committed_capital numeric(18, 2) not null default 0,
  called_capital  numeric(18, 2) not null default 0,
  distributed_capital numeric(18, 2) not null default 0,
  currency        text not null default 'USD',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index funds_org_idx on public.funds (organization_id);

create trigger funds_set_updated_at
  before update on public.funds
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- commitments — Capital graph edges: an investor's commitment to a fund.
-- ---------------------------------------------------------------------------
create table public.commitments (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  fund_id           uuid not null references public.funds (id) on delete cascade,
  investor_id       uuid not null references public.investors (id) on delete cascade,
  committed_amount  numeric(18, 2) not null,
  called_amount     numeric(18, 2) not null default 0,
  distributed_amount numeric(18, 2) not null default 0,
  committed_at      date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (fund_id, investor_id)
);

create index commitments_org_idx on public.commitments (organization_id);
create index commitments_fund_idx on public.commitments (fund_id);
create index commitments_investor_idx on public.commitments (investor_id);

create trigger commitments_set_updated_at
  before update on public.commitments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- capital_events — calls, distributions, waterfalls (Execute > Capital Events).
-- Optionally scoped to a specific investor (e.g. a single LP's call notice).
-- ---------------------------------------------------------------------------
create table public.capital_events (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fund_id         uuid not null references public.funds (id) on delete cascade,
  investor_id     uuid references public.investors (id) on delete set null,
  event_type      capital_event_type not null,
  amount          numeric(18, 2) not null,
  currency        text not null default 'USD',
  effective_date  date not null,
  due_date        date,
  reference       text,                        -- call/distribution notice number
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index capital_events_org_idx on public.capital_events (organization_id);
create index capital_events_fund_idx on public.capital_events (fund_id);

create trigger capital_events_set_updated_at
  before update on public.capital_events
  for each row execute function public.set_updated_at();
