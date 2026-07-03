-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
CREATE TABLE IF NOT EXISTS meeting_notes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id           uuid        REFERENCES deals(id) ON DELETE SET NULL,
  title             text        NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  participants      text[]      NOT NULL DEFAULT '{}',
  transcript        text,
  calendar_event_id text,
  analysis          jsonb,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_all" ON meeting_notes
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE principal_id = auth.uid()
    )
  );

COMMENT ON TABLE  meeting_notes                IS 'Meeting transcripts and AI analysis produced by Meeting Copilot.';
COMMENT ON COLUMN meeting_notes.analysis       IS 'JSON payload: sentiment, objections[], commitment_probability, follow_up_draft, crm_updates.';
COMMENT ON COLUMN meeting_notes.calendar_event_id IS 'Google Calendar event ID when fed from Calendar MCP.';;
