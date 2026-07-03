-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_dev boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS tasks_is_dev_idx ON tasks (organization_id, is_dev)
  WHERE is_dev = false;;
