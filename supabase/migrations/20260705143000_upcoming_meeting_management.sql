-- Native upcoming meeting management fields.

alter table public.live_meetings
  add column if not exists description text,
  add column if not exists location text,
  add column if not exists meeting_url text,
  add column if not exists attendees jsonb not null default '[]',
  add column if not exists source text not null default 'fundexecs',
  add column if not exists source_event_id text,
  add column if not exists source_calendar_id text,
  add column if not exists related_contact_id uuid,
  add column if not exists related_company_id uuid,
  add column if not exists related_fund_id uuid,
  add column if not exists priority text not null default 'normal',
  add column if not exists tags text[] not null default '{}',
  add column if not exists sync_status text not null default 'local_only',
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_source_check'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_source_check
      check (source in ('fundexecs','google_calendar','gmail','outlook','calendly','zoom','google_meet','manual'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_priority_check'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_priority_check
      check (priority in ('low','normal','high','critical'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_sync_status_check'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_sync_status_check
      check (sync_status in ('local_only','synced','pending_sync','sync_failed','deleted_local','deleted_external'));
  end if;
end $$;

create index if not exists live_meetings_org_deleted_scheduled_idx
  on public.live_meetings (organization_id, deleted_at, scheduled_at);
