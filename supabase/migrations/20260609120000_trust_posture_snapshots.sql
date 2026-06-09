-- =====================================================================
-- Trust Center — posture history.
--
-- Stores a daily snapshot of an org's Institutional Readiness Index and
-- capital-coverage so the /trust surface can show the index *moving*
-- (delta since the last snapshot + a small trend line) instead of only a
-- static reading. One row per org per day; the app upserts on each load.
--
-- Additive + idempotent. RLS: org members read/write their own org's rows.
-- =====================================================================

create table if not exists public.trust_posture_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_date date not null default current_date,
  iri integer not null default 0,
  coverage_pct integer not null default 0,
  captured_at timestamp with time zone not null default now(),
  unique (org_id, snapshot_date)
);

create index if not exists trust_posture_snapshots_org_date_idx
  on public.trust_posture_snapshots (org_id, snapshot_date desc);

alter table public.trust_posture_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trust_posture_snapshots'
      and policyname = 'members read posture snapshots'
  ) then
    create policy "members read posture snapshots" on public.trust_posture_snapshots
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trust_posture_snapshots'
      and policyname = 'members insert posture snapshots'
  ) then
    create policy "members insert posture snapshots" on public.trust_posture_snapshots
      for insert to authenticated
      with check (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trust_posture_snapshots'
      and policyname = 'members update posture snapshots'
  ) then
    create policy "members update posture snapshots" on public.trust_posture_snapshots
      for update to authenticated
      using (private.is_org_member(org_id))
      with check (private.is_org_member(org_id));
  end if;
end$$;

grant select, insert, update on public.trust_posture_snapshots to authenticated;
