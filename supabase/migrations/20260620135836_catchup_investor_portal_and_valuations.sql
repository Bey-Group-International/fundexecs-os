-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
create table if not exists public.investor_portal_shares (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  investor_id     uuid not null references public.investors (id) on delete cascade,
  token           text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  label           text,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);
do $$ begin
  create index if not exists investor_portal_shares_org_idx on public.investor_portal_shares (organization_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  create index if not exists investor_portal_shares_investor_idx on public.investor_portal_shares (investor_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

create table if not exists public.investor_portal_views (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  share_id        uuid references public.investor_portal_shares (id) on delete set null,
  created_at      timestamptz not null default now()
);
do $$ begin
  create index if not exists investor_portal_views_org_idx on public.investor_portal_views (organization_id, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

alter table public.investor_portal_shares enable row level security;
alter table public.investor_portal_views  enable row level security;

drop policy if exists investor_portal_shares_select on public.investor_portal_shares;
create policy investor_portal_shares_select on public.investor_portal_shares
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists investor_portal_shares_write on public.investor_portal_shares;
create policy investor_portal_shares_write on public.investor_portal_shares
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists investor_portal_views_select on public.investor_portal_views;
create policy investor_portal_views_select on public.investor_portal_views
  for select using (organization_id in (select public.current_principal_org_ids()));

create table if not exists public.valuation_marks (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  asset_id        uuid not null references public.assets (id) on delete cascade,
  value           numeric not null,
  as_of           date not null default current_date,
  method          text,
  note            text,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now()
);
do $$ begin
  create index if not exists valuation_marks_asset_idx on public.valuation_marks (asset_id, as_of desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  create index if not exists valuation_marks_org_idx on public.valuation_marks (organization_id, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

alter table public.valuation_marks enable row level security;

drop policy if exists valuation_marks_select on public.valuation_marks;
create policy valuation_marks_select on public.valuation_marks
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists valuation_marks_write on public.valuation_marks;
create policy valuation_marks_write on public.valuation_marks
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));;
