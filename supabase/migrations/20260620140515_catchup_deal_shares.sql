-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
create table if not exists public.deal_shares (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id         uuid not null references public.deals (id) on delete cascade,
  token           text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  memo            text not null,
  created_by      uuid references public.principals (id) on delete set null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
do $$ begin
  create index if not exists deal_shares_org_idx on public.deal_shares (organization_id, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  create index if not exists deal_shares_deal_idx on public.deal_shares (deal_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  drop trigger if exists deal_shares_set_updated_at on public.deal_shares;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  create trigger deal_shares_set_updated_at
  before update on public.deal_shares
  for each row execute function public.set_updated_at();
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

create table if not exists public.deal_share_recipients (
  id              uuid primary key default extensions.gen_random_uuid(),
  share_id        uuid not null references public.deal_shares (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  investor_id     uuid references public.investors (id) on delete set null,
  score           integer not null default 0 check (score between 0 and 100),
  rationale       jsonb not null default '[]'::jsonb,
  source          text not null default 'matched' check (source in ('matched', 'forwarded')),
  created_at      timestamptz not null default now()
);
do $$ begin
  create index if not exists deal_share_recipients_org_idx on public.deal_share_recipients (organization_id, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  create index if not exists deal_share_recipients_share_idx on public.deal_share_recipients (share_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

create table if not exists public.deal_share_views (
  id              uuid primary key default extensions.gen_random_uuid(),
  share_id        uuid not null references public.deal_shares (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  viewer_org_id   uuid references public.organizations (id) on delete set null,
  viewer_label    text,
  created_at      timestamptz not null default now()
);
do $$ begin
  create index if not exists deal_share_views_share_idx on public.deal_share_views (share_id, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  create index if not exists deal_share_views_org_idx on public.deal_share_views (organization_id, created_at desc);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

do $$ begin
  alter table public.deal_shares enable row level security;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  alter table public.deal_share_recipients enable row level security;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  alter table public.deal_share_views enable row level security;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

drop policy if exists deal_shares_select on public.deal_shares;
do $$ begin
  create policy deal_shares_select on public.deal_shares
  for select using (organization_id in (select public.current_principal_org_ids()));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
drop policy if exists deal_shares_write on public.deal_shares;
do $$ begin
  create policy deal_shares_write on public.deal_shares
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

drop policy if exists deal_share_recipients_select on public.deal_share_recipients;
do $$ begin
  create policy deal_share_recipients_select on public.deal_share_recipients
  for select using (organization_id in (select public.current_principal_org_ids()));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

drop policy if exists deal_share_views_select on public.deal_share_views;
do $$ begin
  create policy deal_share_views_select on public.deal_share_views
  for select using (organization_id in (select public.current_principal_org_ids()));
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;;
