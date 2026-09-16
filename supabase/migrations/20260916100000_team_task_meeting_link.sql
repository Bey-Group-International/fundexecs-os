-- 20260916100000_team_task_meeting_link.sql
-- Which meeting raised a task.
--
-- Action items became team tasks with nothing recording where they came from,
-- so nothing could tell whether an item had already been raised. That was
-- survivable while every task landed on the host's own list. It is not now:
-- tasks are assigned to the person the item names, and a report produced twice
-- — a retry after a lost response, or a host regenerating because the first
-- read wrong — files the same commitment on a colleague's list twice.
--
-- Nullable and ON DELETE SET NULL: a task outlives the meeting that raised it.
-- Somebody still owes the work after the meeting record is gone.

alter table public.team_tasks
  add column if not exists meeting_id uuid references public.live_meetings (id) on delete set null;

comment on column public.team_tasks.meeting_id is
  'The live meeting whose report raised this task, when one did. Used to avoid raising the same action item twice.';

-- The lookup this exists for: "what has this meeting already raised?", asked
-- once per report run, immediately before writing.
create index if not exists team_tasks_meeting_idx
  on public.team_tasks (meeting_id)
  where meeting_id is not null;
