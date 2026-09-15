-- Making the saved transcript worth reading.
--
-- `live_meeting_transcripts` was written by every participant and read by
-- nobody. The report was built from whatever the host's browser still held in
-- memory when they pressed End, so a host whose tab crashed, reloaded or ran
-- out of battery lost the meeting outright — while the rows that could have
-- rebuilt it sat in this table, unread.
--
-- Two columns close the gap between what a row holds and what the report needs,
-- so a transcript reconstructed here is the same text the room would have
-- posted rather than a degraded copy:
--
--   `overlapped` — whether somebody else was audible over these words. The
--   client has always tracked it and the report has always rendered it ("Alina
--   (uncertain — people speaking over each other): …"), but it was dropped on
--   the way into the database, so a rebuilt line could only say "uncertain"
--   and not why.
--
--   `ended_meeting_id` is NOT added, deliberately: a line belongs to a meeting
--   and the meeting knows when it ended.

ALTER TABLE live_meeting_transcripts
  ADD COLUMN IF NOT EXISTS overlapped boolean NOT NULL DEFAULT false;

-- Reading a meeting back is always "every line, oldest first". Without this the
-- planner sorts the whole partition on each report.
CREATE INDEX IF NOT EXISTS live_meeting_transcripts_meeting_ts_idx
  ON live_meeting_transcripts (meeting_id, ts);

-- Writes are idempotent from here on.
--
-- The client supplies each row's `id` — it already mints one per utterance to
-- key the React list — so a flush that times out can be retried with the same
-- ids and conflict harmlessly instead of storing the sentence twice. That
-- matters more than it sounds: a retry used to be the choice between losing a
-- line and duplicating it, so the code did neither and simply dropped anything
-- whose insert failed.
--
-- `id` is already the primary key, so the conflict target exists; this comment
-- is the only record of why callers must send it.
COMMENT ON COLUMN live_meeting_transcripts.id IS
  'Client-minted per utterance so a retried flush upserts instead of duplicating.';

COMMENT ON COLUMN live_meeting_transcripts.overlapped IS
  'Someone else was audible over these words; renders the "speaking over each other" note.';
