-- Speaker identity on live transcript lines.
--
-- `speaker` alone is a display name typed into the join screen: it changes
-- mid-call, two guests can pick the same one, and it says nothing about which
-- account was behind the voice. These columns record who actually spoke, so a
-- report generated after everyone has left can still tell two "Alex"es apart.
--
-- `confidence` is the client's own attribution certainty (see
-- lib/meetings/speaker-attribution.ts). A line captured while people spoke over
-- each other is stored, but stored as doubtful rather than as fact.

ALTER TABLE live_meeting_transcripts
  ADD COLUMN IF NOT EXISTS speaker_id      text,
  ADD COLUMN IF NOT EXISTS speaker_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confidence      real;

-- Rows written before this migration carry no attribution metadata; they are
-- left null rather than back-filled with a guess.
CREATE INDEX IF NOT EXISTS live_meeting_transcripts_speaker_idx
  ON live_meeting_transcripts (meeting_id, speaker_id);
