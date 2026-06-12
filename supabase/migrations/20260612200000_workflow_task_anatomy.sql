-- =====================================================================
-- Workflow tasks: the board-card anatomy (Run hub · Workflows tab).
--
-- The prototype's kanban cards and task drawer carry a task name, an
-- owner, a why-it-matters line, the next action, a critical-path flag,
-- a due label and a real subtask checklist. The original seed stored
-- the task name as the only `subtasks` entry; these columns give every
-- field a real home. Additive + idempotent; RLS unchanged (the member
-- read/write policies from 20260611102000 + 20260611260000 cover the
-- whole row).
-- =====================================================================

alter table public.workflow_tasks add column if not exists name text;
alter table public.workflow_tasks add column if not exists who text;
alter table public.workflow_tasks add column if not exists drives text;
alter table public.workflow_tasks add column if not exists action text;
alter table public.workflow_tasks add column if not exists due_label text;
alter table public.workflow_tasks
  add column if not exists critical boolean not null default false;

-- Backfill: the legacy seed wrote `subtasks = [{"name": <task name>}]` as a
-- name holder, not a checklist. Move it into the new column and clear the
-- placeholder. Guarded on `name is null` so re-runs are no-ops.
update public.workflow_tasks
set
  name = subtasks -> 0 ->> 'name',
  subtasks = '[]'::jsonb
where
  name is null
  and jsonb_typeof(subtasks) = 'array'
  and jsonb_array_length(subtasks) = 1
  and subtasks -> 0 ->> 'name' is not null
  and (subtasks -> 0 -> 'done') is null;

comment on column public.workflow_tasks.name is
  'Task title shown on the board card.';
comment on column public.workflow_tasks.who is
  'Specialist who owns the step (first name from the team roster).';
comment on column public.workflow_tasks.drives is
  'Why the step matters — the card''s drives line.';
comment on column public.workflow_tasks.action is
  'The next concrete action label for the approve loop.';
comment on column public.workflow_tasks.due_label is
  'Optional human-readable due label shown on the card badge.';
comment on column public.workflow_tasks.critical is
  'True when the step is on the critical path (gold top border + blocking CTA).';
