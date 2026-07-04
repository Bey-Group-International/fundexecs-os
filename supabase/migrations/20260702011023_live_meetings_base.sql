-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.

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
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text        NOT NULL,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz
);

CREATE TABLE IF NOT EXISTS live_meeting_transcripts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  speaker    text,
  text       text        NOT NULL,
  ts         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_meeting_reports (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id       uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  summary          text,
  key_points       jsonb       NOT NULL DEFAULT '[]',
  action_items     jsonb       NOT NULL DEFAULT '[]',
  full_transcript  text,
  analysis         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE live_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_meeting_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_meeting_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_meetings_select" ON live_meetings;
DROP POLICY IF EXISTS "live_meetings_insert" ON live_meetings;
DROP POLICY IF EXISTS "live_meetings_update" ON live_meetings;
DROP POLICY IF EXISTS "live_meeting_participants_self" ON live_meeting_participants;
DROP POLICY IF EXISTS "live_meeting_transcripts_meeting" ON live_meeting_transcripts;
DROP POLICY IF EXISTS "live_meeting_reports_meeting" ON live_meeting_reports;

CREATE POLICY "live_meetings_select" ON live_meetings FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM organization_members WHERE principal_id = auth.uid()
    )
  );

CREATE POLICY "live_meetings_insert" ON live_meetings FOR INSERT
  WITH CHECK (host_id = auth.uid());

CREATE POLICY "live_meetings_update" ON live_meetings FOR UPDATE
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid());

CREATE POLICY "live_meeting_participants_self" ON live_meeting_participants
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "live_meeting_transcripts_meeting" ON live_meeting_transcripts
  USING (
    meeting_id IN (
      SELECT id FROM live_meetings WHERE host_id = auth.uid()
      UNION
      SELECT meeting_id FROM live_meeting_participants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "live_meeting_reports_meeting" ON live_meeting_reports
  USING (
    meeting_id IN (
      SELECT id FROM live_meetings WHERE host_id = auth.uid()
      UNION
      SELECT meeting_id FROM live_meeting_participants WHERE user_id = auth.uid()
    )
  );

ALTER TABLE live_meetings ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES meeting_notes(id) ON DELETE SET NULL;

do $$ begin
  CREATE INDEX IF NOT EXISTS live_meetings_host_id_idx ON live_meetings (host_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS live_meetings_deal_id_idx ON live_meetings (deal_id) WHERE deal_id IS NOT NULL;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS live_meeting_participants_user_id_idx ON live_meeting_participants (user_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS live_meeting_participants_meeting_id_idx ON live_meeting_participants (meeting_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS live_meeting_reports_meeting_id_idx ON live_meeting_reports (meeting_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;
do $$ begin
  CREATE INDEX IF NOT EXISTS live_meeting_transcripts_meeting_id_idx ON live_meeting_transcripts (meeting_id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'live_meetings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE live_meetings;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'live_meeting_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE live_meeting_participants;
  END IF;
END $$;
;
