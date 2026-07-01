-- Migration: Investor & Deal Outreach Sequences (Feature 09).
--
-- Two tables:
--   outreach_sequences    — reusable multi-step outreach templates per org
--   sequence_enrollments  — tracks a specific target moving through a sequence

-- ── outreach_sequences ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outreach_sequences (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  steps         jsonb       NOT NULL DEFAULT '[]',
  stop_on_reply boolean     NOT NULL DEFAULT true,
  active        boolean     NOT NULL DEFAULT false,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- If this table was created by an older migration (e.g. 0060 on main), the new
-- columns may not exist yet. ADD COLUMN IF NOT EXISTS makes this idempotent.
ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS org_id        uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS steps         jsonb       NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS stop_on_reply boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS active        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON TABLE outreach_sequences IS 'Multi-step outreach templates (email, slack, envelope) scoped to an org.';
COMMENT ON COLUMN outreach_sequences.steps IS 'Ordered array of step objects: {step_index, channel, delay_days, subject, body_template, stop_if_replied}.';
COMMENT ON COLUMN outreach_sequences.stop_on_reply IS 'When true, a reply from the target halts further steps.';

ALTER TABLE outreach_sequences ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS outreach_sequences_org_id_idx ON outreach_sequences(org_id);
CREATE INDEX IF NOT EXISTS outreach_sequences_active_idx ON outreach_sequences(active);

DROP POLICY IF EXISTS "org_members_outreach_sequences" ON outreach_sequences;
CREATE POLICY "org_members_outreach_sequences" ON outreach_sequences
  FOR ALL USING (
    org_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );

-- ── sequence_enrollments ──────────────────────────────────────────────────────

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

COMMENT ON TABLE sequence_enrollments IS 'Tracks a specific target (investor/deal/contact) progressing through an outreach sequence.';
COMMENT ON COLUMN sequence_enrollments.target_type IS 'Type of entity enrolled: investor | deal | contact.';
COMMENT ON COLUMN sequence_enrollments.next_step_at IS 'When the next step should be dispatched; checked by cron sweep.';
COMMENT ON COLUMN sequence_enrollments.stopped_reason IS 'Why the sequence was stopped: reply_received | manual | completed.';

ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS sequence_enrollments_sequence_id_idx  ON sequence_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS sequence_enrollments_target_id_idx    ON sequence_enrollments(target_id);
CREATE INDEX IF NOT EXISTS sequence_enrollments_next_step_at_idx ON sequence_enrollments(next_step_at);
CREATE INDEX IF NOT EXISTS sequence_enrollments_stopped_at_idx   ON sequence_enrollments(stopped_at);

DROP POLICY IF EXISTS "org_members_sequence_enrollments" ON sequence_enrollments;
CREATE POLICY "org_members_sequence_enrollments" ON sequence_enrollments
  FOR ALL USING (
    sequence_id IN (
      SELECT s.id FROM outreach_sequences s
      JOIN organization_members om ON om.organization_id = s.org_id
      WHERE om.principal_id = auth.uid()
    )
  );
