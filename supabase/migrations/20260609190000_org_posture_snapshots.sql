-- ============================================================================
-- org_posture_snapshots — daily history of the Institutional Posture composite.
--
-- The four-pillar posture (Compliance · Governance · Execution · Capital) is
-- computed live on every /strategy load by lib/strategy/posture.ts and thrown
-- away. Persisting one snapshot per org per day unlocks two compounding reads
-- the blueprint's Phase 3 calls for — momentum Δ + streak (latest vs prior) and
-- a peer percentile against the same-stage / same-member-type cohort — without
-- a cron job: the page upserts today's row when it renders.
--
-- Mirrors the sibling readiness_snapshots table (20260609150000): one row per
-- (org_id, snapshot_date), table-level RLS scoped to org members, plus a
-- SECURITY DEFINER upsert RPC so the daily write is a single authorized call
-- (the same shape as the credit/grant RPCs). The cohort columns (stage,
-- member_type) are denormalized onto the snapshot so the percentile read needs
-- no join across RLS boundaries. Additive + idempotent.
-- ============================================================================

create table if not exists public.org_posture_snapshots (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  -- The day this snapshot represents (UTC date). The dedupe key with org_id.
  snapshot_date date not null default (now() at time zone 'utc')::date,
  -- 0–100 weighted composite over the measurable pillars (the headline number).
  composite     integer not null,
  -- The four pillar sub-scores, 0–100 each. Nullable: a pillar can be unmeasured
  -- (e.g. governance with no objectives authored) — stored as null, never a
  -- fabricated zero, so the trend stays honest.
  compliance    integer,
  governance    integer,
  execution     integer,
  capital       integer,
  -- Cohort keys, denormalized for the same-stage / same-member-type percentile.
  -- Nullable so a snapshot still records when the stage/type isn't resolved yet.
  stage         text,
  member_type   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, snapshot_date)
);

create index if not exists org_posture_snapshots_org_day_idx
  on public.org_posture_snapshots (org_id, snapshot_date desc);

-- Cohort lookup for the peer percentile: latest snapshots in a stage/type bucket.
create index if not exists org_posture_snapshots_cohort_idx
  on public.org_posture_snapshots (snapshot_date desc, stage, member_type);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.org_posture_snapshots'::regclass
  ) then
    create trigger set_updated_at
      before update on public.org_posture_snapshots
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- RLS — org members read and write their own org's snapshots.
alter table public.org_posture_snapshots enable row level security;

revoke all on table public.org_posture_snapshots from anon, authenticated;
grant select, insert, update on table public.org_posture_snapshots to authenticated;
grant select, insert, update, delete on table public.org_posture_snapshots to service_role;

drop policy if exists "members read org_posture_snapshots" on public.org_posture_snapshots;
create policy "members read org_posture_snapshots"
  on public.org_posture_snapshots
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists "members insert org_posture_snapshots" on public.org_posture_snapshots;
create policy "members insert org_posture_snapshots"
  on public.org_posture_snapshots
  for insert to authenticated
  with check (private.is_org_member(org_id));

drop policy if exists "members update org_posture_snapshots" on public.org_posture_snapshots;
create policy "members update org_posture_snapshots"
  on public.org_posture_snapshots
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- upsert_org_posture_snapshot — idempotent daily writeback.
--
-- One authorized call writes (or refreshes) today's snapshot for the org. Mirrors
-- the credit/grant RPCs: SECURITY DEFINER with an empty search_path and an
-- explicit membership check, so the client never needs broad table grants to
-- record telemetry. Pillar sub-scores are nullable (an unmeasured pillar passes
-- null through, never a fabricated zero). No-ops the row's identity on conflict —
-- re-running the same day just refreshes the scores.
-- ----------------------------------------------------------------------------
create or replace function public.upsert_org_posture_snapshot(
  _org_id       uuid,
  _composite    integer,
  _compliance   integer default null,
  _governance   integer default null,
  _execution    integer default null,
  _capital      integer default null,
  _stage        text default null,
  _member_type  text default null
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

  insert into public.org_posture_snapshots
    (org_id, snapshot_date, composite, compliance, governance, execution, capital, stage, member_type)
  values
    (_org_id, _today, _composite, _compliance, _governance, _execution, _capital, _stage, _member_type)
  on conflict (org_id, snapshot_date) do update set
    composite   = excluded.composite,
    compliance  = excluded.compliance,
    governance  = excluded.governance,
    execution   = excluded.execution,
    capital     = excluded.capital,
    stage       = excluded.stage,
    member_type = excluded.member_type,
    updated_at  = now();
end;
$$;

revoke all on function public.upsert_org_posture_snapshot(
  uuid, integer, integer, integer, integer, integer, text, text
) from public, anon;
grant execute on function public.upsert_org_posture_snapshot(
  uuid, integer, integer, integer, integer, integer, text, text
) to authenticated, service_role;
