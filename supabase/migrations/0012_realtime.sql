-- 0012_realtime.sql
-- Stream the task-engine loop to the live workspace. Adding tables to the
-- `supabase_realtime` publication lets authenticated clients subscribe to
-- changes; RLS still applies, so subscribers only receive rows for their org.
alter publication supabase_realtime add table public.task_events;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.approvals;
