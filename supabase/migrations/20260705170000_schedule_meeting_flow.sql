-- Refined Schedule Meeting flow: institutional Meeting Edit Screen fields,
-- draft/locked lifecycle, native internal calendar linkage, and third-party
-- calendar sync state. All additive and idempotent.

alter table public.live_meetings
  -- Meeting Edit Screen configuration.
  add column if not exists objective text,
  add column if not exists agenda text,
  add column if not exists preparation_requirements text,
  add column if not exists attachments jsonb not null default '[]',
  add column if not exists calendar_visibility text not null default 'organization',
  add column if not exists reminder_minutes integer,
  add column if not exists assigned_copilot_agent text,
  -- Generic related workspace record (fund / deal / company / investor / workspace).
  add column if not exists related_record_type text,
  add column if not exists related_record_id uuid,
  -- Native internal calendar is the source of truth; this id names the meeting's
  -- entry on it. Third-party calendars are external mirrors only.
  add column if not exists internal_calendar_event_id uuid,
  -- Third-party calendar mirror.
  add column if not exists external_calendar_provider text,
  add column if not exists external_calendar_event_id text,
  add column if not exists external_calendar_sync_enabled boolean not null default false,
  add column if not exists external_calendar_sync_status text not null default 'not_connected',
  add column if not exists external_calendar_last_error text,
  -- Draft vs saved/locked lifecycle.
  add column if not exists is_draft boolean not null default false,
  add column if not exists locked_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_calendar_visibility_check'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_calendar_visibility_check
      check (calendar_visibility in ('private','team','organization','public'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_related_record_type_check'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_related_record_type_check
      check (related_record_type is null or related_record_type in ('fund','deal','company','investor','workspace'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_external_provider_check'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_external_provider_check
      check (external_calendar_provider is null or external_calendar_provider in ('google_calendar','outlook','calendly','ical'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_external_sync_status_check'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_external_sync_status_check
      check (external_calendar_sync_status in ('not_connected','sync_off','sync_pending','synced','sync_failed','needs_resync'));
  end if;
end $$;

-- Keep updated_at fresh on every write.
create or replace function public.live_meetings_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists live_meetings_set_updated_at on public.live_meetings;
create trigger live_meetings_set_updated_at
  before update on public.live_meetings
  for each row execute function public.live_meetings_touch_updated_at();

-- Upcoming Meetings query filters out drafts and deleted rows by scheduled time.
create index if not exists live_meetings_org_draft_scheduled_idx
  on public.live_meetings (organization_id, is_draft, scheduled_at)
  where deleted_at is null;

comment on column public.live_meetings.internal_calendar_event_id is
  'Stable id for this meeting on the native internal calendar (the source of truth). Set when the meeting is saved/locked.';
comment on column public.live_meetings.external_calendar_sync_status is
  'UI-facing third-party sync state: not_connected | sync_off | sync_pending | synced | sync_failed | needs_resync.';
comment on column public.live_meetings.is_draft is
  'True while a meeting is being configured on the Meeting Edit Screen. Drafts do not appear in Upcoming Meetings or on the internal calendar.';
