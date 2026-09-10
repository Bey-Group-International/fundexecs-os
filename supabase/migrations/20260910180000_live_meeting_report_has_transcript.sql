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
-- The trim set is JavaScript's, exactly, because JavaScript is what it has to
-- agree with -- `String.prototype.trim` in app/api/meetings/[id]/report/
-- regenerate. That is ECMAScript WhiteSpace + LineTerminator: the six ASCII
-- ones, NBSP, ZWNBSP (the BOM), LS, PS, and the Unicode Zs category.
--
-- Two ways to get this wrong, and they are not symmetric:
--
--   too FEW characters here -> a transcript of nothing but, say, NBSP counts as
--     present, the log offers the button, and the route trims it to empty and
--     answers 409. A control that fails when pressed.
--   too MANY -> a real transcript could read as absent and the button would be
--     missing. Also wrong, but it fails closed.
--
-- Matching exactly avoids both. Bare `btrim(text)` is the first mistake at its
-- worst: it strips SPACES ONLY, so "\n\n\n" -- what a meeting whose lines all
-- came through empty produces, since lines are joined with "\n" -- reads as a
-- transcript.
--
-- Dropped first rather than relying on IF NOT EXISTS alone. The column is
-- derived from full_transcript and holds nothing of its own, so re-deriving it
-- is free; and if an earlier revision of this file ever landed somewhere with a
-- different expression, IF NOT EXISTS would silently keep the wrong one.

ALTER TABLE live_meeting_reports
  DROP COLUMN IF EXISTS has_transcript;

ALTER TABLE live_meeting_reports
  ADD COLUMN has_transcript boolean
  GENERATED ALWAYS AS (
    full_transcript IS NOT NULL
    AND length(btrim(
      full_transcript,
      -- ASCII: TAB LF VT FF CR SP
      E'\t\n\u000B\f\r ' ||
      -- NBSP, ZWNBSP (BOM), LINE SEPARATOR, PARAGRAPH SEPARATOR
      E'\u00A0\uFEFF\u2028\u2029' ||
      -- Unicode Zs: OGHAM SPACE MARK, EN QUAD .. HAIR SPACE,
      -- NARROW NO-BREAK SPACE, MEDIUM MATHEMATICAL SPACE, IDEOGRAPHIC SPACE
      E'\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000'
    )) > 0
  ) STORED;

COMMENT ON COLUMN live_meeting_reports.has_transcript IS
  'Generated: true when full_transcript holds more than whitespace, using JavaScript''s trim set so it agrees with the regenerate route. Lets the meeting log gate "Regenerate from transcript" without reading the transcript itself. Never written by the application.';
