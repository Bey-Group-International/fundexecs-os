-- 20260720130000_office_presence_events.sql
-- Team presence & collaboration analytics for the Virtual Office, behind a
-- per-member OPT-IN privacy model.
--
-- `office_presence_events` is an append-only stream of what each member does in
-- the office (join/leave, status changes, room enter/leave). Rows are written
-- ONLY for members who have opted in (enforced in the app layer); the aggregate
-- dashboard folds the stream into session/room durations and co-presence.
--
-- `office_member_prefs` holds each member's opt-in flag. A member manages their
-- own row; fellow org members may READ the opt-in flags so the dashboard knows
-- who is (and isn't) counted.
--
-- Tenancy mirrors office_layouts (20260720120000): member-read scoped to
-- `current_principal_org_ids()`, with self-scoped writes keyed to `auth.uid()`.
-- Idempotent so a preview-branch replay is a no-op.

-- ---------------------------------------------------------------------------
-- office_presence_events — append-only presence stream
-- ---------------------------------------------------------------------------
create table if not exists public.office_presence_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  principal_id    uuid not null
    references public.principals (id) on delete cascade,
  kind            text not null
    check (kind in ('join', 'leave', 'status', 'room_enter', 'room_leave')),
  room_key        text,
  status          text,
  created_at      timestamptz not null default now()
);

-- Bounded recent-reads: the fetcher scans the freshest rows for an org.
create index if not exists office_presence_events_org_created_idx
  on public.office_presence_events (organization_id, created_at desc);

alter table public.office_presence_events enable row level security;

-- SELECT — any member of the org may read the org's presence stream.
drop policy if exists office_presence_events_select on public.office_presence_events;
create policy office_presence_events_select on public.office_presence_events
  for select using (organization_id in (select public.current_principal_org_ids()));

-- INSERT — a member may only record events AS THEMSELVES, within an org they
-- belong to. No update/delete policy: the stream is append-only.
drop policy if exists office_presence_events_insert on public.office_presence_events;
create policy office_presence_events_insert on public.office_presence_events
  for insert with check (
    principal_id = auth.uid()
    and organization_id in (select public.current_principal_org_ids())
  );

-- ---------------------------------------------------------------------------
-- office_member_prefs — per-member analytics opt-in
-- ---------------------------------------------------------------------------
create table if not exists public.office_member_prefs (
  organization_id   uuid not null
    references public.organizations (id) on delete cascade,
  principal_id      uuid not null
    references public.principals (id) on delete cascade,
  analytics_opt_in  boolean not null default false,
  updated_at        timestamptz not null default now(),
  primary key (organization_id, principal_id)
);

drop trigger if exists office_member_prefs_set_updated_at on public.office_member_prefs;
create trigger office_member_prefs_set_updated_at
  before update on public.office_member_prefs
  for each row execute function public.set_updated_at();

alter table public.office_member_prefs enable row level security;

-- SELECT — org members may read opt-in flags for aggregation (this also covers
-- a member reading their own row).
drop policy if exists office_member_prefs_select on public.office_member_prefs;
create policy office_member_prefs_select on public.office_member_prefs
  for select using (organization_id in (select public.current_principal_org_ids()));

-- INSERT — a member may only create their own pref row, within their org.
drop policy if exists office_member_prefs_insert on public.office_member_prefs;
create policy office_member_prefs_insert on public.office_member_prefs
  for insert with check (
    principal_id = auth.uid()
    and organization_id in (select public.current_principal_org_ids())
  );

-- UPDATE — a member may only manage their own pref row.
drop policy if exists office_member_prefs_update on public.office_member_prefs;
create policy office_member_prefs_update on public.office_member_prefs
  for update using (principal_id = auth.uid())
  with check (
    principal_id = auth.uid()
    and organization_id in (select public.current_principal_org_ids())
  );

comment on table public.office_presence_events is
  'Append-only Virtual Office presence stream (opt-in members only) feeding team analytics.';
comment on table public.office_member_prefs is
  'Per-member Virtual Office analytics opt-in; org members may read flags for aggregation.';
