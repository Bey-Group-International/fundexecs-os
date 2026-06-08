-- ============================================================================
-- Cap Table — ownership / holdings entries per org.
--
-- Additive + idempotent. One org-scoped table with RLS:
--   cap_table_entries — individual holder rows (founders, investors, pool…)
--
-- Members SELECT via private.is_org_member(org_id).
-- Admins/owners INSERT/UPDATE/DELETE via private.is_org_admin(org_id).
-- `set_updated_at` trigger on updated_at column.
-- ============================================================================

create table if not exists public.cap_table_entries (
  id              uuid          primary key default gen_random_uuid(),
  org_id          uuid          not null references public.organizations(id) on delete cascade,
  holder_name     text          not null,
  holder_type     text          not null default 'investor'
                  check (holder_type in ('founder', 'investor', 'option_pool', 'safe', 'other')),
  security_type   text          not null default 'common'
                  check (security_type in ('common', 'preferred', 'safe', 'option', 'warrant', 'other')),
  units           numeric(24, 6) not null default 0 check (units >= 0),
  amount_invested numeric(18, 2) check (amount_invested >= 0),
  ownership_pct   numeric(7, 4)  check (ownership_pct >= 0 and ownership_pct <= 100),
  as_of_date      date,
  memo            text,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

create index if not exists cap_table_entries_org_id_idx
  on public.cap_table_entries (org_id);

-- updated_at trigger
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.cap_table_entries'::regclass
  ) then
    create trigger set_updated_at
      before update on public.cap_table_entries
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.cap_table_entries enable row level security;

drop policy if exists "members read cap_table_entries" on public.cap_table_entries;
create policy "members read cap_table_entries" on public.cap_table_entries
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists "admins insert cap_table_entries" on public.cap_table_entries;
create policy "admins insert cap_table_entries" on public.cap_table_entries
  for insert to authenticated
  with check (private.is_org_admin(org_id));

drop policy if exists "admins update cap_table_entries" on public.cap_table_entries;
create policy "admins update cap_table_entries" on public.cap_table_entries
  for update to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));

drop policy if exists "admins delete cap_table_entries" on public.cap_table_entries;
create policy "admins delete cap_table_entries" on public.cap_table_entries
  for delete to authenticated
  using (private.is_org_admin(org_id));
