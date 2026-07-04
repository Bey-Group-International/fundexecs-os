-- Migration: meeting_notes table for Meeting Copilot.
--
-- Stores meeting transcripts and the AI-derived analysis (sentiment, objections,
-- commitment probability, suggested follow-ups, CRM field updates).
-- Linked to an org; optionally to a deal or contact.
--
-- analysis column stores the full MeetingAnalysis JSON payload so new fields
-- can be added without schema migrations.

CREATE TABLE IF NOT EXISTS meeting_notes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id           uuid        REFERENCES deals(id) ON DELETE SET NULL,
  title             text        NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  participants      text[]      NOT NULL DEFAULT '{}',
  transcript        text,
  -- Google Calendar event reference (optional)
  calendar_event_id text,
  -- Full AI analysis payload
  analysis          jsonb,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;

-- Guarded like the 20260701155438 backfill twin of this migration: on a fresh
-- database (e.g. a Supabase preview branch) the backfill has already created
-- this policy, and a bare CREATE POLICY here aborts the whole replay.
do $$ begin
  CREATE POLICY "org_members_all" ON meeting_notes
    USING (
      organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE principal_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

COMMENT ON TABLE  meeting_notes                IS 'Meeting transcripts and AI analysis produced by Meeting Copilot.';
COMMENT ON COLUMN meeting_notes.analysis       IS 'JSON payload: sentiment, objections[], commitment_probability, follow_up_draft, crm_updates.';
COMMENT ON COLUMN meeting_notes.calendar_event_id IS 'Google Calendar event ID when fed from Calendar MCP.';
