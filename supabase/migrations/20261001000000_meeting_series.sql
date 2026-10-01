-- Repeating meetings.
--
-- Each occurrence stays its own live_meetings row — its own room, reminders,
-- notes and report — and the rows of one series share series_id, which is the
-- id of the first occurrence. That makes the series' calendar identity
-- (meeting-<series_id>@…) the same shape as any single meeting's, so the rest
-- of the app recognises it.
--
-- series_original_start is the occurrence's slot in the rule. It never moves
-- when the occurrence does: it is the RECURRENCE-ID that tells an invitee's
-- calendar which instance of the series an update is about.
ALTER TABLE public.live_meetings
  ADD COLUMN IF NOT EXISTS series_id uuid,
  ADD COLUMN IF NOT EXISTS series_index integer,
  ADD COLUMN IF NOT EXISTS series_rule text,
  ADD COLUMN IF NOT EXISTS series_original_start timestamptz;

CREATE INDEX IF NOT EXISTS live_meetings_series_idx
  ON public.live_meetings (series_id, series_index)
  WHERE series_id IS NOT NULL;
