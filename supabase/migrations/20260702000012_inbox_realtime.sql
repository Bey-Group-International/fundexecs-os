-- 20260702000012_inbox_realtime.sql
-- Put the Unified Inbox on the realtime bus. The inbox page now subscribes to
-- its org's inbox_threads / inbox_messages changes (app/(app)/inbox/InboxLive)
-- so a newly ingested thread, a triage update, or an incoming reply refreshes
-- the board without a manual reload — the same idiom as tasks/approvals (0012),
-- artifacts (0015), team_tasks (0050), and live_meetings.
--
-- Guarded + idempotent: only adds each table when the publication exists and the
-- table isn't already a member, so it is safe to re-run and on databases where
-- the publication was provisioned differently.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'inbox_threads'
     ) then
    alter publication supabase_realtime add table public.inbox_threads;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'inbox_messages'
     ) then
    alter publication supabase_realtime add table public.inbox_messages;
  end if;
end $$;
