-- ============================================================================
-- LP Room — distributions + capital account entries.
--
-- Additive + idempotent. New org-scoped tables with RLS:
--   distributions             — org-level distribution events
--   capital_account_entries   — ledger lines for the capital-account statement
--
-- Members SELECT via private.is_org_member(org_id).
-- Admins/owners INSERT/UPDATE/DELETE via private.is_org_admin(org_id).
-- `set_updated_at` trigger on tables that carry an `updated_at` column.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. distributions
-- ---------------------------------------------------------------------------

create table if not exists public.distributions (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        not null references public.organizations(id) on delete cascade,
  lp_id         uuid        references public.capital_providers(id) on delete set null,
  amount        numeric(18, 2) not null default 0 check (amount >= 0),
  distribution_date date    not null default current_date,
  kind          text        not null default 'return_of_capital'
                check (kind in (
                  'return_of_capital', 'profit', 'dividend',
                  'recallable', 'special', 'other'
                )),
  status        text        not null default 'pending'
                check (status in ('pending', 'paid', 'cancelled')),
  memo          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists distributions_org_date_idx
  on public.distributions (org_id, distribution_date desc);

create index if not exists distributions_org_lp_idx
  on public.distributions (org_id, lp_id);

-- updated_at trigger
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.distributions'::regclass
  ) then
    create trigger set_updated_at
      before update on public.distributions
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2. capital_account_entries
-- ---------------------------------------------------------------------------

create table if not exists public.capital_account_entries (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        not null references public.organizations(id) on delete cascade,
  lp_id         uuid        references public.capital_providers(id) on delete set null,
  entry_date    date        not null default current_date,
  entry_type    text        not null
                check (entry_type in (
                  'commitment', 'capital_call', 'distribution',
                  'nav_adjustment', 'fee', 'other'
                )),
  amount        numeric(18, 2) not null,
  balance_after numeric(18, 2),
  memo          text,
  created_at    timestamptz not null default now()
);

create index if not exists capital_account_entries_org_date_idx
  on public.capital_account_entries (org_id, entry_date desc);

create index if not exists capital_account_entries_org_lp_idx
  on public.capital_account_entries (org_id, lp_id);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table public.distributions enable row level security;
alter table public.capital_account_entries enable row level security;

-- distributions policies
drop policy if exists "members read distributions" on public.distributions;
create policy "members read distributions" on public.distributions
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists "admins insert distributions" on public.distributions;
create policy "admins insert distributions" on public.distributions
  for insert to authenticated
  with check (private.is_org_admin(org_id));

drop policy if exists "admins update distributions" on public.distributions;
create policy "admins update distributions" on public.distributions
  for update to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

drop policy if exists "admins delete distributions" on public.distributions;
create policy "admins delete distributions" on public.distributions
  for delete to authenticated
  using (private.is_org_admin(org_id));

-- capital_account_entries policies
drop policy if exists "members read capital_account_entries" on public.capital_account_entries;
create policy "members read capital_account_entries" on public.capital_account_entries
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists "admins insert capital_account_entries" on public.capital_account_entries;
create policy "admins insert capital_account_entries" on public.capital_account_entries
  for insert to authenticated
  with check (private.is_org_admin(org_id));

drop policy if exists "admins update capital_account_entries" on public.capital_account_entries;
create policy "admins update capital_account_entries" on public.capital_account_entries
  for update to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

drop policy if exists "admins delete capital_account_entries" on public.capital_account_entries;
create policy "admins delete capital_account_entries" on public.capital_account_entries
  for delete to authenticated
  using (private.is_org_admin(org_id));
