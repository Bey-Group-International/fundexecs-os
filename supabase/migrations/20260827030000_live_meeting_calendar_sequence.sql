-- A strictly increasing revision for a meeting's calendar invitation.
--
-- The same property scheduling_bookings needed, for the same reason: a client
-- matches an update to an entry it already holds by UID, and ignores one whose
-- SEQUENCE has not advanced. Without this, rescheduling a meeting would either
-- leave the old time in everyone's calendar or add a second entry beside it.
--
-- Deriving it from timestamps was tried on bookings and is wrong: two changes
-- inside one second share a value, and the later one is silently dropped.

ALTER TABLE public.live_meetings
  ADD COLUMN IF NOT EXISTS calendar_sequence integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.bump_live_meeting_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Every update, not only the calendar-relevant ones. An extra increment is
  -- harmless — a client accepts any higher SEQUENCE — while a missing one
  -- silently strands a reschedule.
  NEW.calendar_sequence := OLD.calendar_sequence + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS live_meetings_bump_sequence ON public.live_meetings;
CREATE TRIGGER live_meetings_bump_sequence
  BEFORE UPDATE ON public.live_meetings
  FOR EACH ROW EXECUTE FUNCTION public.bump_live_meeting_sequence();

COMMENT ON COLUMN public.live_meetings.calendar_sequence IS
  'iCalendar SEQUENCE for this meeting. Bumped by trigger on every update, never derived from timestamps.';
