-- Migration: extend the existing outreach_sequences table with Feature 09 columns.
-- The original outreach_sequences table was created with organization_id, channel, etc.
-- Feature 09 needs org_id, steps (jsonb), stop_on_reply, and active columns.

ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS stop_on_reply boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT false;

-- Backfill org_id from organization_id where not yet set
UPDATE outreach_sequences SET org_id = organization_id WHERE org_id IS NULL AND organization_id IS NOT NULL;

COMMENT ON COLUMN outreach_sequences.steps IS 'Ordered array of step objects for Feature 09 sequences.';
COMMENT ON COLUMN outreach_sequences.stop_on_reply IS 'Halt further steps when target replies.';
COMMENT ON COLUMN outreach_sequences.active IS 'Whether this sequence is actively available for enrollment.';

-- sequence_enrollments is created in 20260701280000 (IF NOT EXISTS) — this is a no-op if it exists.
CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id   uuid        NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  target_type   text        NOT NULL CHECK (target_type IN ('investor','deal','contact')),
  target_id     uuid        NOT NULL,
  current_step  int         NOT NULL DEFAULT 0,
  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  next_step_at  timestamptz,
  completed_at  timestamptz,
  stopped_at    timestamptz,
  stopped_reason text
);

ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS sequence_enrollments_sequence_id_idx ON sequence_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS sequence_enrollments_target_id_idx   ON sequence_enrollments(target_id);
CREATE INDEX IF NOT EXISTS sequence_enrollments_next_step_at_idx ON sequence_enrollments(next_step_at);

DROP POLICY IF EXISTS "org_members_sequence_enrollments" ON sequence_enrollments;
CREATE POLICY "org_members_sequence_enrollments" ON sequence_enrollments
  FOR ALL USING (
    sequence_id IN (
      SELECT s.id FROM outreach_sequences s
      JOIN organization_members om ON om.organization_id = COALESCE(s.org_id, s.organization_id)
      WHERE om.principal_id = auth.uid()
    )
  );
