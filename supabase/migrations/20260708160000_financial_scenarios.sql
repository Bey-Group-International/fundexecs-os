-- 20260708160000_financial_scenarios.sql
--
-- Saved financial-model scenarios for the interactive modeling tools: the LBO
-- returns model (Run › Underwriting) and the fund-life distribution waterfall
-- (Execute › Waterfall). Each row stores a named set of inputs (jsonb) under a
-- `kind` discriminator, optionally linked to a deal. Org-scoped, member-read /
-- writer-write RLS, mirroring the rest of the domain. Fully idempotent.

create table if not exists public.financial_scenarios (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  deal_id          uuid references public.deals (id) on delete set null,
  kind             text not null check (kind in ('lbo', 'waterfall')),
  name             text not null,
  inputs           jsonb not null default '{}',
  created_by       uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists financial_scenarios_org_kind_idx
  on public.financial_scenarios (organization_id, kind, created_at desc);

drop trigger if exists financial_scenarios_set_updated_at on public.financial_scenarios;
create trigger financial_scenarios_set_updated_at
  before update on public.financial_scenarios
  for each row execute function public.set_updated_at();

alter table public.financial_scenarios enable row level security;

drop policy if exists financial_scenarios_select on public.financial_scenarios;
create policy financial_scenarios_select on public.financial_scenarios
  for select
  using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists financial_scenarios_write on public.financial_scenarios;
create policy financial_scenarios_write on public.financial_scenarios
  for all
  using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
