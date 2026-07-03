-- 20260703210000_task_completed_with_errors.sql
-- A workflow whose steps partly failed (a Claude outage, a dead integration,
-- an insufficient-credits error) used to have its status forced to
-- 'completed' regardless — the only failure signal lived on the child step
-- rows, which most workflow-level UI never reads. This adds a status the
-- engine (lib/engine.ts's executeWorkflow) sets when some but not all of a
-- workflow's steps failed, so the system of record stops claiming full
-- success for partial work. When every step fails, the workflow is set to
-- the existing 'failed' status instead, and no deal/asset is seeded from it.
alter type task_status add value if not exists 'completed_with_errors';
