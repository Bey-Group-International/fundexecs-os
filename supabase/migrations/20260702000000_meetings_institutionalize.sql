-- Add deal linkage and performance indexes to meeting tables

ALTER TABLE live_meetings
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES meeting_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS live_meetings_host_id_idx ON live_meetings (host_id);
CREATE INDEX IF NOT EXISTS live_meetings_deal_id_idx ON live_meetings (deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS live_meeting_participants_user_id_idx ON live_meeting_participants (user_id);
CREATE INDEX IF NOT EXISTS live_meeting_participants_meeting_id_idx ON live_meeting_participants (meeting_id);
CREATE INDEX IF NOT EXISTS live_meeting_reports_meeting_id_idx ON live_meeting_reports (meeting_id);
CREATE INDEX IF NOT EXISTS live_meeting_transcripts_meeting_id_idx ON live_meeting_transcripts (meeting_id);
