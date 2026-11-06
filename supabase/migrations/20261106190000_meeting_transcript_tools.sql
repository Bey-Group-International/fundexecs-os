-- 20261106190000_meeting_transcript_tools.sql
-- A meeting's transcript, correctable after the meeting without losing what
-- was heard.
--
--   live_meeting_speaker_names   the name to show for a speaker label as the
--                                room heard it ("Speaker 2" → "Dana Okafor"),
--                                one row per label per meeting.
--   live_meeting_transcript_edits a correction to one transcript line, beside
--                                the line; the line itself is never rewritten,
--                                so the original stays readable and undoing a
--                                correction is deleting its row.
--
-- Both are applied when the transcript is read (lib/meetings/transcript-tools.ts).
-- The routes write with the service role after checking the caller is the
-- meeting's host; the policies below let the people who were in the meeting
-- read them, the same rule the transcript itself follows.

CREATE TABLE IF NOT EXISTS live_meeting_speaker_names (
  meeting_id uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  original   text        NOT NULL CHECK (length(original) BETWEEN 1 AND 200),
  display    text        NOT NULL CHECK (length(display) BETWEEN 1 AND 80),
  updated_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, original)
);

CREATE TABLE IF NOT EXISTS live_meeting_transcript_edits (
  line_id    uuid        PRIMARY KEY REFERENCES live_meeting_transcripts(id) ON DELETE CASCADE,
  meeting_id uuid        NOT NULL REFERENCES live_meetings(id) ON DELETE CASCADE,
  text       text        NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  edited_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_meeting_transcript_edits_meeting_idx
  ON live_meeting_transcript_edits (meeting_id);

ALTER TABLE live_meeting_speaker_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_meeting_transcript_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live_meeting_speaker_names_attendee_read" ON live_meeting_speaker_names;
DROP POLICY IF EXISTS "live_meeting_transcript_edits_attendee_read" ON live_meeting_transcript_edits;

do $$ begin
  CREATE POLICY "live_meeting_speaker_names_attendee_read" ON live_meeting_speaker_names
  FOR SELECT USING (public.attended_live_meeting(meeting_id));
exception when undefined_function or undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  CREATE POLICY "live_meeting_transcript_edits_attendee_read" ON live_meeting_transcript_edits
  FOR SELECT USING (public.attended_live_meeting(meeting_id));
exception when undefined_function or undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

COMMENT ON TABLE live_meeting_speaker_names IS
  'The name to show for a speaker label as the room heard it. Applied when the transcript is read.';
COMMENT ON TABLE live_meeting_transcript_edits IS
  'A correction to one transcript line, kept beside it; the line itself is never rewritten.';
