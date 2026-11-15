-- 20261115120000_live_meeting_line_speakers.sql
-- Who really said one transcript line, when the room could not tell.
--
-- Everyone in one room often shares a single microphone, so every line from
-- that device is stored under the device owner's name. The host can say who
-- actually spoke, line by line, after the fact. Like speaker names and line
-- corrections, this is an overlay: the stored line is never rewritten, the
-- name lives beside it, and undoing it is deleting its row. It is applied when
-- the transcript is read (lib/meetings/transcript-tools.ts).
--
-- The route writes with the service role after checking the caller is the
-- meeting's host; the policy lets the people who were in the meeting read it,
-- the same rule the transcript itself follows.

CREATE TABLE IF NOT EXISTS live_meeting_line_speakers (
  line_id     uuid        PRIMARY KEY REFERENCES live_meeting_transcripts(id) ON DELETE CASCADE,
  meeting_id  uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  speaker     text        NOT NULL CHECK (length(speaker) BETWEEN 1 AND 80),
  assigned_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_meeting_line_speakers_meeting_idx
  ON live_meeting_line_speakers (meeting_id);

ALTER TABLE live_meeting_line_speakers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_meeting_line_speakers_attendee_read" ON live_meeting_line_speakers;

do $$ begin
  CREATE POLICY "live_meeting_line_speakers_attendee_read" ON live_meeting_line_speakers
  FOR SELECT USING (public.attended_live_meeting(meeting_id));
exception when undefined_function or undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

COMMENT ON TABLE live_meeting_line_speakers IS
  'Who actually said one transcript line, set by the host where several people shared a microphone. The line itself is never rewritten.';
