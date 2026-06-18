-- 0013_workflow_steps.sql
-- Multi-step agent plans (the Copilot choreography). A prompt produces a
-- "workflow" (a parent task, parent_task_id IS NULL) plus ordered "steps"
-- (child tasks). step_order sequences the steps within a workflow.
alter table public.tasks
  add column step_order int not null default 0;

create index tasks_workflow_steps_idx
  on public.tasks (parent_task_id, step_order);
