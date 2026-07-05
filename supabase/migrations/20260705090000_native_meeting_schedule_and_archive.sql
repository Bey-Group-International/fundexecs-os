-- Native institutional meetings: scheduled rooms + meeting archive linkage.

alter table public.live_meetings
  add column if not exists deal_id uuid,
  add column if not exists scheduled_at timestamptz,
  add column if not exists duration_minutes integer not null default 60,
  add column if not exists timezone text not null default 'UTC',
  add column if not exists meeting_type text not null default 'internal_strategy',
  add column if not exists preparation_status text not null default 'prep_needed',
  add column if not exists followup_status text not null default 'not_started',
  add column if not exists notes_snapshot jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_duration_positive'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_duration_positive check (duration_minutes > 0 and duration_minutes <= 480);
  end if;
exception when undefined_table or duplicate_object then null;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_deal_id_fkey'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings drop constraint live_meetings_deal_id_fkey;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'deals'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'live_meetings_deal_id_deals_fkey'
      and conrelid = 'public.live_meetings'::regclass
  ) then
    alter table public.live_meetings
      add constraint live_meetings_deal_id_deals_fkey
      foreign key (deal_id) references public.deals(id) on delete set null;
  end if;
exception when undefined_table or undefined_column or duplicate_object then null;
end $$;

create index if not exists live_meetings_org_scheduled_idx
  on public.live_meetings (organization_id, scheduled_at)
  where scheduled_at is not null;

create index if not exists live_meetings_org_status_idx
  on public.live_meetings (organization_id, status, created_at desc);
