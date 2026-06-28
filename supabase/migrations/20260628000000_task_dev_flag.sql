-- Add is_dev flag to tasks so QA/debug sessions can tag tasks for easy
-- filtering from production views (Activity feed, Execution Grid history).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_dev boolean NOT NULL DEFAULT false;

-- Index for filtering dev tasks out of production queries.
CREATE INDEX IF NOT EXISTS tasks_is_dev_idx ON tasks (organization_id, is_dev)
  WHERE is_dev = false;
