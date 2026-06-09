-- ============================================================================
-- readiness_snapshots — daily history of the institutional-readiness score.
--
-- The readiness score is computed live on every dashboard load and thrown away.
-- That makes it impossible to show a trend ("up 6 points this week") or to
-- reward momentum. This table persists one snapshot per org per day so the new
-- Readiness surface can render a trend line and a velocity badge without a cron
-- job — the page upserts today's row when it renders.
--
-- One row per (org_id, captured_on). The breakdown is stored as jsonb so the
-- per-dimension series is recoverable later without a schema change. Additive +
-- idempotent.
-- ============================================================================

create table if not exists public.readiness_snapshots (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  -- The day this snapshot represents (UTC date). The dedupe key with org_id.
  captured_on  date not null default (now() at time zone 'utc')::date,
  -- 0–100 compound readiness score (the headline on the Readiness surface).
  score        integer not null,
  -- 0–100 flat weighted-average score, kept alongside so the compounding
  -- premium (compound − base) is recoverable in the trend.
  base_score   integer not null default 0,
  -- Per-dimension breakdown: [{ dimension, score, weight, contribution }, ...].
  breakdown    jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, captured_on)
);

create index if not exists readiness_snapshots_org_day_idx
  on public.readiness_snapshots (org_id, captured_on desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at'
      and tgrelid = 'public.readiness_snapshots'::regclass
  ) then
    create trigger set_updated_at
      before update on public.readiness_snapshots
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- RLS — org members read and write their own org's snapshots.
alter table public.readiness_snapshots enable row level security;

revoke all on table public.readiness_snapshots from anon, authenticated;
grant select, insert, update on table public.readiness_snapshots to authenticated;
grant select, insert, update, delete on table public.readiness_snapshots to service_role;

drop policy if exists "members read readiness_snapshots" on public.readiness_snapshots;
create policy "members read readiness_snapshots"
  on public.readiness_snapshots
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists "members insert readiness_snapshots" on public.readiness_snapshots;
create policy "members insert readiness_snapshots"
  on public.readiness_snapshots
  for insert to authenticated
  with check (private.is_org_member(org_id));

drop policy if exists "members update readiness_snapshots" on public.readiness_snapshots;
create policy "members update readiness_snapshots"
  on public.readiness_snapshots
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));
