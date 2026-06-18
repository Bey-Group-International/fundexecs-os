-- 0005_deals.sql
-- Deal graph + Run/Execute hub artifacts: deals (pipeline), assets (owned),
-- documents, underwritings, diligence items, and risk flags.

-- ---------------------------------------------------------------------------
-- deals — Deal graph nodes (Source > Deal Pipeline, Run hub working set).
-- ---------------------------------------------------------------------------
create table public.deals (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  stage           deal_stage not null default 'sourced',
  asset_class     text,
  geography       text,
  target_amount   numeric(18, 2),
  -- where the deal sits relative to a vehicle, if assigned
  fund_id         uuid references public.funds (id) on delete set null,
  source          text,                        -- broker, off-market, referral...
  lead_principal  uuid references public.principals (id) on delete set null,
  thesis_fit      numeric(4, 3),               -- 0..1 signal score
  expected_close  date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index deals_org_idx on public.deals (organization_id);
create index deals_stage_idx on public.deals (organization_id, stage);
create index deals_name_trgm_idx on public.deals using gin (name extensions.gin_trgm_ops);

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- assets — owned positions post-close (Execute > Asset Management).
-- ---------------------------------------------------------------------------
create table public.assets (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid references public.deals (id) on delete set null,
  fund_id         uuid references public.funds (id) on delete set null,
  name            text not null,
  asset_type      asset_type not null default 'other',
  acquisition_date date,
  acquisition_cost numeric(18, 2),
  current_value   numeric(18, 2),
  noi             numeric(18, 2),              -- net operating income (RE)
  cap_rate        numeric(6, 4),
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index assets_org_idx on public.assets (organization_id);
create index assets_deal_idx on public.assets (deal_id);

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- documents — files attached to deals/assets (S3 keys; Diligence agent input).
-- ---------------------------------------------------------------------------
create table public.documents (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid references public.deals (id) on delete cascade,
  asset_id        uuid references public.assets (id) on delete cascade,
  name            text not null,
  doc_type        text,                        -- om, lease, financials, legal...
  storage_key     text,                        -- S3 object key
  mime_type       text,
  size_bytes      bigint,
  uploaded_by     uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index documents_org_idx on public.documents (organization_id);
create index documents_deal_idx on public.documents (deal_id);

-- ---------------------------------------------------------------------------
-- underwritings — pro formas / financial models (Run > Underwriting).
-- `model` holds the structured assumptions + outputs as JSON for flexibility.
-- ---------------------------------------------------------------------------
create table public.underwritings (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid not null references public.deals (id) on delete cascade,
  name            text not null default 'Base Case',
  scenario        text not null default 'base', -- base / upside / downside / stress
  model           jsonb not null default '{}'::jsonb,
  projected_irr   numeric(6, 4),
  projected_moic  numeric(6, 3),
  equity_required numeric(18, 2),
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index underwritings_org_idx on public.underwritings (organization_id);
create index underwritings_deal_idx on public.underwritings (deal_id);

create trigger underwritings_set_updated_at
  before update on public.underwritings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- diligence_items — diligence checklist / findings (Run > Diligence).
-- ---------------------------------------------------------------------------
create table public.diligence_items (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid not null references public.deals (id) on delete cascade,
  document_id     uuid references public.documents (id) on delete set null,
  category        text not null,               -- legal / financial / market / physical
  title           text not null,
  status          diligence_status not null default 'open',
  risk_severity   risk_severity,
  finding         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index diligence_items_org_idx on public.diligence_items (organization_id);
create index diligence_items_deal_idx on public.diligence_items (deal_id);

create trigger diligence_items_set_updated_at
  before update on public.diligence_items
  for each row execute function public.set_updated_at();
