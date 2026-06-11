-- ============================================================================
-- trust_posture_snapshots — daily history of the Trust Center's Institutional
-- Readiness Index (IRI) + capital coverage.
--
-- The IRI is computed live on every /trust load (lib/queries/trust-center.ts)
-- and thrown away, which makes it impossible to show the index *moving*.
-- Persisting one snapshot per org per day lets the surface render a delta
-- ("▲ 6 pts since…") and a small trend line without a cron job — the page
-- upserts today's row when it renders.
--
-- Mirrors the sibling snapshot tables readiness_snapshots (20260609150000) and
-- org_posture_snapshots (20260609190000): one row per (org_id, snapshot_date),
-- table-level RLS scoped to org members for reads, and a SECURITY DEFINER
-- upsert RPC so the daily write is a single authorized call with no broad
-- table-write grants. Additive + idempotent.
-- ============================================================================

create table if not exists public.trust_posture_snapshots (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  -- The day this snapshot represents (UTC date). The dedupe key with org_id.
  snapshot_date date not null default (now() at time zone 'utc')::date,
  -- 0–100 capital-weighted Institutional Readiness Index (the headline number).
  iri           integer not null,
  -- 0–100 share of active pipeline sitting behind a Proven-or-better chain.
  coverage_pct  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, snapshot_date),
  -- Both scores are 0–100 by construction (clamped in the writer); enforce that
  -- at the DB so a bad writer can't store garbage.
  constraint trust_posture_snapshots_iri_range check (iri between 0 and 100),
  constraint trust_posture_snapshots_coverage_range check (coverage_pct between 0 and 100)
);

create index if not exists trust_posture_snapshots_org_day_idx
  on public.trust_posture_snapshots (org_id, snapshot_date desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.trust_posture_snapshots'::regclass
  ) then
    create trigger set_updated_at
      before update on public.trust_posture_snapshots
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- RLS — org members read their own org's snapshots. Writes go through the
-- SECURITY DEFINER RPC below, so authenticated needs no table-write grant.
alter table public.trust_posture_snapshots enable row level security;

revoke all on table public.trust_posture_snapshots from anon, authenticated;
grant select on table public.trust_posture_snapshots to authenticated;
grant select, insert, update, delete on table public.trust_posture_snapshots to service_role;

drop policy if exists "members read trust_posture_snapshots" on public.trust_posture_snapshots;
create policy "members read trust_posture_snapshots"
  on public.trust_posture_snapshots
  for select to authenticated
  using (private.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- upsert_trust_posture_snapshot — idempotent daily writeback.
--
-- One authorized call writes (or refreshes) today's IRI snapshot for the org.
-- Mirrors upsert_org_posture_snapshot: SECURITY DEFINER with an empty
-- search_path and an explicit membership check, so the client never needs
-- table-write grants. Scores are clamped 0–100. Re-running the same day just
-- refreshes the values.
-- ----------------------------------------------------------------------------
create or replace function public.upsert_trust_posture_snapshot(
  _org_id       uuid,
  _iri          integer,
  _coverage_pct integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _today date := (now() at time zone 'utc')::date;
begin
  if _org_id is null then
    raise exception 'org_id is required' using errcode = '22023';
  end if;

  -- Authorize: the cron (service_role) or an active member of the org.
  if coalesce((select auth.role()), '') <> 'service_role'
     and not exists (
       select 1 from public.org_members om
       where om.org_id = _org_id
         and om.user_id = auth.uid()
         and om.status = 'active'
     )
  then
    raise exception 'not a member of org %', _org_id using errcode = '42501';
  end if;

  insert into public.trust_posture_snapshots (org_id, snapshot_date, iri, coverage_pct)
  values (
    _org_id,
    _today,
    greatest(0, least(100, coalesce(_iri, 0))),
    greatest(0, least(100, coalesce(_coverage_pct, 0)))
  )
  on conflict (org_id, snapshot_date) do update set
    iri          = excluded.iri,
    coverage_pct = excluded.coverage_pct,
    updated_at   = now();
end;
$$;

revoke all on function public.upsert_trust_posture_snapshot(uuid, integer, integer)
  from public, anon;
grant execute on function public.upsert_trust_posture_snapshot(uuid, integer, integer)
  to authenticated, service_role;
