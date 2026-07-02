-- Allow hosts to delete their own meetings (cascades to participants, transcripts, reports)
DROP POLICY IF EXISTS "live_meetings_delete" ON live_meetings;

CREATE POLICY "live_meetings_delete" ON live_meetings FOR DELETE
  USING (host_id = auth.uid());

-- Soft-hide column so hosts can hide meetings from their list without losing data
ALTER TABLE live_meetings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
