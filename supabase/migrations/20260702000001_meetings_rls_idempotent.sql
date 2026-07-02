-- Make live_meetings RLS policies idempotent (drop-before-recreate)
-- The original 20260701240000_live_meetings.sql created these without IF NOT EXISTS,
-- causing errors when the migration is re-applied on branches that already have the tables.

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
