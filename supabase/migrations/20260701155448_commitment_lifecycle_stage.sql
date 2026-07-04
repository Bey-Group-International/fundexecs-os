-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commitment_stage') THEN
    CREATE TYPE commitment_stage AS ENUM (
      'soft_circle',
      'verbal',
      'signed',
      'funded',
      'closed',
      'withdrawn'
    );
  END IF;
END $$;

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS lifecycle_stage commitment_stage NOT NULL DEFAULT 'soft_circle',
  ADD COLUMN IF NOT EXISTS notes           text;

do $$ begin
  COMMENT ON COLUMN commitments.lifecycle_stage IS 'Soft-circle → verbal → signed → funded → closed;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$; withdrawn at any pre-funded stage.';
do $$ begin
  COMMENT ON COLUMN commitments.notes          IS 'Free-text notes on this commitment (LP call summary, conditions, etc).';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;;
