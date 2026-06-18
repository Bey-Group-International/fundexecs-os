-- 0020_source_run_execute.sql
-- Source-hub relationship modules that had no backing table yet: Partners
-- (co-GPs, operating partners, advisors), Providers (outside service providers —
-- legal, audit, fund admin, etc.), and Debt & Hybrid (debt facilities / lenders).
-- Each is a simple, FK-free, org-scoped table following the same member-read /
-- writer-write tenancy as the rest of the domain.

-- Source › Partners: co-GPs, operating partners, advisors, introducers.
create table public.partners (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  name              text not null,
  partner_type      text not null default 'co_gp',  -- co_gp | operating_partner | advisor | introducer | other
  relationship      text,
  contact_name      text,
  contact_email     text,
  status            text not null default 'active',  -- active | prospective | dormant | former
  notes             text,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index partners_org_idx on public.partners (organization_id, created_at desc);

create trigger partners_set_updated_at
  before update on public.partners
  for each row execute function public.set_updated_at();

alter table public.partners enable row level security;

create policy partners_select on public.partners
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy partners_write on public.partners
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- Source › Providers: outside service providers — legal, audit, tax, fund admin,
-- placement, banking.
create table public.service_providers (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  name              text not null,
  provider_type     text not null default 'legal',  -- legal | audit | tax | fund_admin | placement | bank | other
  contact_name      text,
  contact_email     text,
  status            text not null default 'active',  -- active | prospective | former
  notes             text,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index service_providers_org_idx on public.service_providers (organization_id, created_at desc);

create trigger service_providers_set_updated_at
  before update on public.service_providers
  for each row execute function public.set_updated_at();

alter table public.service_providers enable row level security;

create policy service_providers_select on public.service_providers
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy service_providers_write on public.service_providers
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- Source › Debt & Hybrid: debt facilities and hybrid instruments — lines of
-- credit, term loans, mezz, sub debt, prefs — and the lenders behind them.
create table public.debt_facilities (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  name              text not null,
  facility_type     text not null default 'term_loan',  -- term_loan | revolver | mezzanine | sub_debt | bridge | preferred | other
  lender            text,
  commitment_amount numeric,
  interest_rate     numeric,
  currency          text not null default 'USD',
  status            text not null default 'prospective',  -- prospective | term_sheet | committed | drawn | repaid | closed
  maturity_date     date,
  notes             text,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index debt_facilities_org_idx on public.debt_facilities (organization_id, created_at desc);

create trigger debt_facilities_set_updated_at
  before update on public.debt_facilities
  for each row execute function public.set_updated_at();

alter table public.debt_facilities enable row level security;

create policy debt_facilities_select on public.debt_facilities
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy debt_facilities_write on public.debt_facilities
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
