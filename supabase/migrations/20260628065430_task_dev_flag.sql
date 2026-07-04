-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
do $$ begin
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_dev boolean NOT NULL DEFAULT false;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE INDEX IF NOT EXISTS tasks_is_dev_idx ON tasks (organization_id, is_dev)
  WHERE is_dev = false;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;;
