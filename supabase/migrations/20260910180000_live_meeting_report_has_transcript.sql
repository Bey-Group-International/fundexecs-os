-- 20260910180000_live_meeting_report_has_transcript.sql
-- Whether a report row has a transcript behind it, as one cheap boolean.
--
-- The meeting log lists every meeting in the organization with its newest
-- report embedded, and it deliberately does NOT select `full_transcript`:
-- lib/meetings/meeting-log.ts says so in as many words, because a list of two
-- hundred meetings would pull tens of kilobytes per row to decide whether to
-- draw one button.
--
-- But it does need the answer. "Regenerate from transcript" was gated on
-- `hasReport` — `summary.length > 0` — which conflates two different things:
-- whether there is a summary to READ, and whether there is a transcript to
-- re-read. They come apart exactly when it matters. When the model fails at
-- the end of a meeting, app/api/meetings/report writes a row that holds the
-- transcript and an empty summary; that row has everything regeneration needs
-- and yet hid the only control that would use it.
--
-- GENERATED ALWAYS ... STORED, so it is computed once on write and read like
-- any other column — never written by the application. Postgres computes it
-- for existing rows as it adds the column.
--
-- Trimmed because the failure path writes an empty string, and a transcript of
-- nothing but whitespace is not one: the regenerate route trims before its own
-- "nothing to analyse" check, and this has to agree with it or the log offers a
-- button that answers 409.
--
-- The trim set is spelled out. Bare `btrim(text)` strips SPACES ONLY, which is
-- the wrong answer here: a transcript is built by joining lines with "\n", so a
-- meeting where every line came through empty produces "\n\n\n" — whitespace by
-- any reading, and non-empty to a space-only trim. Matching JavaScript's
-- String.prototype.trim on the characters that actually occur.

ALTER TABLE live_meeting_reports
  ADD COLUMN IF NOT EXISTS has_transcript boolean
  GENERATED ALWAYS AS (
    full_transcript IS NOT NULL
    AND length(btrim(full_transcript, E' \t\n\r\f\v')) > 0
  ) STORED;

COMMENT ON COLUMN live_meeting_reports.has_transcript IS
  'Generated: true when full_transcript holds more than whitespace. Lets the meeting log gate "Regenerate from transcript" without reading the transcript itself. Never written by the application.';
