-- ============================================================================
-- admin_launch_snapshots — daily history of the Admin portal's launch picture.
--
-- The Overview tab's funnel (members, invites, applications, referral credits)
-- is computed live on every render and thrown away, so the portal can show
-- where the launch IS but never how fast it's MOVING. Persisting one snapshot
-- per org per day lets the Overview render deltas ("+3 members since Monday")
-- and a small trend without a cron job — the page upserts today's row when a
-- platform admin renders it.
--
-- Mirrors the sibling snapshot tables trust_posture_snapshots (20260609220000),
-- readiness_snapshots and org_posture_snapshots: one row per
-- (org_id, snapshot_date), table-level RLS scoped to org members for reads,
-- and a SECURITY DEFINER upsert RPC so the daily write is a single authorized
-- call with no broad table-write grants. Additive + idempotent.
-- ============================================================================

create table if not exists public.admin_launch_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  -- The day this snapshot represents (UTC date). The dedupe key with org_id.
  snapshot_date         date not null default (now() at time zone 'utc')::date,
  members               integer not null default 0,
  invites_sent          integer not null default 0,
  invites_accepted      integer not null default 0,
  applications          integer not null default 0,
  applications_approved integer not null default 0,
  referred_count        integer not null default 0,
  credits_earned        integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, snapshot_date),
  -- Counts are non-negative by construction (clamped in the writer); enforce
  -- that at the DB so a bad writer can't store garbage.
  constraint admin_launch_snapshots_nonnegative check (
    members >= 0 and invites_sent >= 0 and invites_accepted >= 0
    and applications >= 0 and applications_approved >= 0
    and referred_count >= 0 and credits_earned >= 0
  )
);

create index if not exists admin_launch_snapshots_org_day_idx
  on public.admin_launch_snapshots (org_id, snapshot_date desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.admin_launch_snapshots'::regclass
  ) then
    create trigger set_updated_at
      before update on public.admin_launch_snapshots
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- RLS — org members read their own org's snapshots. Writes go through the
-- SECURITY DEFINER RPC below, so authenticated needs no table-write grant.
alter table public.admin_launch_snapshots enable row level security;

revoke all on table public.admin_launch_snapshots from anon, authenticated;
grant select on table public.admin_launch_snapshots to authenticated;
grant select, insert, update, delete on table public.admin_launch_snapshots to service_role;

drop policy if exists "members read admin_launch_snapshots" on public.admin_launch_snapshots;
create policy "members read admin_launch_snapshots"
  on public.admin_launch_snapshots
  for select to authenticated
  using (private.is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- upsert_admin_launch_snapshot — idempotent daily writeback.
--
-- One authorized call writes (or refreshes) today's launch counts for the org.
-- Mirrors upsert_trust_posture_snapshot: SECURITY DEFINER with an empty
-- search_path and an explicit membership check, so the client never needs
-- table-write grants. Counts are clamped to >= 0. Re-running the same day just
-- refreshes the values.
-- ----------------------------------------------------------------------------
create or replace function public.upsert_admin_launch_snapshot(
  _org_id                uuid,
  _members               integer default 0,
  _invites_sent          integer default 0,
  _invites_accepted      integer default 0,
  _applications          integer default 0,
  _applications_approved integer default 0,
  _referred_count        integer default 0,
  _credits_earned        integer default 0
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

  insert into public.admin_launch_snapshots (
    org_id, snapshot_date, members, invites_sent, invites_accepted,
    applications, applications_approved, referred_count, credits_earned
  )
  values (
    _org_id,
    _today,
    greatest(0, coalesce(_members, 0)),
    greatest(0, coalesce(_invites_sent, 0)),
    greatest(0, coalesce(_invites_accepted, 0)),
    greatest(0, coalesce(_applications, 0)),
    greatest(0, coalesce(_applications_approved, 0)),
    greatest(0, coalesce(_referred_count, 0)),
    greatest(0, coalesce(_credits_earned, 0))
  )
  on conflict (org_id, snapshot_date) do update set
    members               = excluded.members,
    invites_sent          = excluded.invites_sent,
    invites_accepted      = excluded.invites_accepted,
    applications          = excluded.applications,
    applications_approved = excluded.applications_approved,
    referred_count        = excluded.referred_count,
    credits_earned        = excluded.credits_earned,
    updated_at            = now();
end;
$$;

revoke all on function public.upsert_admin_launch_snapshot(
  uuid, integer, integer, integer, integer, integer, integer, integer
) from public, anon;
grant execute on function public.upsert_admin_launch_snapshot(
  uuid, integer, integer, integer, integer, integer, integer, integer
) to authenticated, service_role;
