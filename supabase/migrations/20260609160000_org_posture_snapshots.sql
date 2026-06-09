-- Strategy Phase 3b: org posture snapshots + peer percentile.
--
-- A daily snapshot of each org's Institutional Posture composite, written
-- lazily when a member loads /strategy (one upsert per org per day). Powers
-- posture momentum (Δ vs. prior snapshots) and a peer percentile.
--
-- Direct row access is org-scoped via `private.is_org_member`. The percentile
-- is computed by a SECURITY DEFINER function that ranks across the whole cohort
-- but only ever returns an aggregate (percentile + cohort size) — never another
-- org's identity or score. search_path is pinned per the definer-hardening
-- convention (see 20260609130000_harden_definer_functions.sql).

create table if not exists public.org_posture_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  captured_on date not null default current_date,
  score numeric(5, 2) not null,
  lanes jsonb not null default '{}'::jsonb,
  stage text,
  member_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, captured_on)
);

create index if not exists idx_org_posture_snapshots_org_day
  on public.org_posture_snapshots (org_id, captured_on desc);
create index if not exists idx_org_posture_snapshots_member_type
  on public.org_posture_snapshots (member_type);

alter table public.org_posture_snapshots enable row level security;

revoke all on table public.org_posture_snapshots from anon, authenticated;
grant select, insert, update on table public.org_posture_snapshots to authenticated;
grant select, insert, update on table public.org_posture_snapshots to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_posture_snapshots'
      and policyname = 'members read own org posture'
  ) then
    create policy "members read own org posture" on public.org_posture_snapshots
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_posture_snapshots'
      and policyname = 'members insert own org posture'
  ) then
    create policy "members insert own org posture" on public.org_posture_snapshots
      for insert to authenticated
      with check (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_posture_snapshots'
      and policyname = 'members update own org posture'
  ) then
    create policy "members update own org posture" on public.org_posture_snapshots
      for update to authenticated
      using (private.is_org_member(org_id))
      with check (private.is_org_member(org_id));
  end if;
end$$;

-- Peer percentile across the latest snapshot per org. SECURITY DEFINER so it
-- can rank against the whole cohort, but it returns ONLY an aggregate
-- (percentile + cohort size). Cohort is scoped to the same member_type when one
-- is provided; pass null for the whole-platform cohort.
create or replace function public.posture_percentile(_member_type text, _score numeric)
returns table (percentile integer, cohort_count integer)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (org_id) org_id, score, member_type
    from public.org_posture_snapshots
    order by org_id, captured_on desc
  ),
  cohort as (
    select score from latest
    where _member_type is null or member_type is not distinct from _member_type
  )
  select
    case
      when count(*) = 0 then null
      else round(100.0 * count(*) filter (where score <= _score) / count(*))::int
    end as percentile,
    count(*)::int as cohort_count
  from cohort;
$$;

revoke all on function public.posture_percentile(text, numeric) from public, anon;
grant execute on function public.posture_percentile(text, numeric) to authenticated, service_role;
