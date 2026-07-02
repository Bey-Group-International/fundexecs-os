-- Migration: add lifecycle_stage to commitments table.
--
-- The Commitment-to-Close Tracker needs to track the LP commitment pipeline
-- from soft-circle through funded/closed. Existing rows default to
-- "soft_circle" so no data is lost.

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

COMMENT ON COLUMN commitments.lifecycle_stage IS 'Soft-circle → verbal → signed → funded → closed; withdrawn at any pre-funded stage.';
COMMENT ON COLUMN commitments.notes          IS 'Free-text notes on this commitment (LP call summary, conditions, etc).';
