-- Intelligence Layer: persist the authoritative routing on each workflow so the
-- Execution Grid can surface work by engine (not just hub), and the UI renders
-- the same classification the planner produced — no client-side recompute drift.
--
-- Free-text (not enums) on purpose: the lifecycle taxonomy lives in
-- lib/intelligence.ts and evolves there without a migration each time.
alter table tasks add column if not exists lifecycle_stage text;
alter table tasks add column if not exists target_engine text;

-- Pane filtering: routed workflows are parents (parent_task_id is null).
create index if not exists tasks_target_engine_idx
  on tasks (organization_id, target_engine)
  where parent_task_id is null and target_engine is not null;
