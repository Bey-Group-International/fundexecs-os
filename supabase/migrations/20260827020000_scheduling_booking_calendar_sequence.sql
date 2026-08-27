-- A strictly increasing revision for the booking's calendar invitation.
--
-- SEQUENCE used to be derived from the seconds elapsed between created_at and
-- updated_at. Two changes inside the same second produced the same SEQUENCE,
-- and a calendar client ignores an update that is not newer than the entry it
-- already holds — so the later reschedule or cancellation was silently dropped
-- and a stale meeting stayed on the invitee's calendar.

ALTER TABLE public.scheduling_bookings
  ADD COLUMN IF NOT EXISTS calendar_sequence integer NOT NULL DEFAULT 0;

-- Backfill to whatever was already sent, so no existing booking's SEQUENCE
-- moves backwards on its next change. Starting every row at 0 would make the
-- next REQUEST look older than the one already sitting in someone's calendar.
UPDATE public.scheduling_bookings
   SET calendar_sequence = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (updated_at - created_at)))::int)
 WHERE calendar_sequence = 0;

CREATE OR REPLACE FUNCTION public.bump_scheduling_booking_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Every update, not only the calendar-relevant ones. An extra increment is
  -- harmless — a client accepts any higher SEQUENCE — while a missing one is
  -- exactly the bug this replaces.
  NEW.calendar_sequence := OLD.calendar_sequence + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scheduling_bookings_bump_sequence ON public.scheduling_bookings;
CREATE TRIGGER scheduling_bookings_bump_sequence
  BEFORE UPDATE ON public.scheduling_bookings
  FOR EACH ROW EXECUTE FUNCTION public.bump_scheduling_booking_sequence();

COMMENT ON COLUMN public.scheduling_bookings.calendar_sequence IS
  'iCalendar SEQUENCE for this booking. Bumped by trigger on every update, never derived from timestamps.';
