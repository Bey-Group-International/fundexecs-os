-- Migration: live_meetings for real-time video meeting rooms
--
-- Adds tables for WebRTC-based live meetings with room codes,
-- participant tracking, live transcripts, and post-meeting reports.

CREATE TABLE IF NOT EXISTS live_meetings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code       text        NOT NULL UNIQUE,
  title           text        NOT NULL DEFAULT 'Meeting',
  host_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  status          text        NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'ended')),
  started_at      timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_meeting_participants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text       NOT NULL,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  left_at     timestamptz
);

CREATE TABLE IF NOT EXISTS live_meeting_transcripts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  speaker     text,
  text        text        NOT NULL,
  ts          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_meeting_reports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  summary     text,
  key_points  jsonb       NOT NULL DEFAULT '[]',
  action_items jsonb      NOT NULL DEFAULT '[]',
  full_transcript text,
  analysis    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE live_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_meeting_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_meeting_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "live_meetings_org" ON live_meetings
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );

CREATE POLICY "live_meeting_participants_self" ON live_meeting_participants
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "live_meeting_transcripts_meeting" ON live_meeting_transcripts
  USING (
    meeting_id IN (
      SELECT id FROM live_meetings WHERE host_id = auth.uid()
      UNION
      SELECT meeting_id FROM live_meeting_participants WHERE principal_id = auth.uid()
    )
  );

CREATE POLICY "live_meeting_reports_meeting" ON live_meeting_reports
  USING (
    meeting_id IN (
      SELECT id FROM live_meetings WHERE host_id = auth.uid()
      UNION
      SELECT meeting_id FROM live_meeting_participants WHERE principal_id = auth.uid()
    )
  );

-- Enable realtime for signaling channel
ALTER PUBLICATION supabase_realtime ADD TABLE live_meetings;
ALTER PUBLICATION supabase_realtime ADD TABLE live_meeting_participants;

COMMENT ON TABLE live_meetings IS 'Live video meeting rooms with WebRTC mesh topology.';
COMMENT ON TABLE live_meeting_transcripts IS 'Live speech-to-text transcript chunks from meeting participants.';
COMMENT ON TABLE live_meeting_reports IS 'Post-meeting AI-generated reports: summary, key points, action items.';
