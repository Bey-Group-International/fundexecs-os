-- 20260724120000_scheduling_booking_overlap_guard.sql
-- Make double-booking impossible at the database level.
--
-- createBooking / approveBooking / rescheduleBooking all re-derive the host's
-- open slots and then write — check-then-act, with nothing holding the slot in
-- between. Two invitees hitting the same open time concurrently both pass the
-- check and both get a confirmed booking, a room, and a confirmation email.
-- Application code cannot close that window on its own; only the database can.
--
-- The exclusion constraint below is the arbiter: for one host, no two live
-- bookings may cover overlapping time. Ranges are half-open, so a booking
-- ending at 10:30 and the next starting at 10:30 do not conflict. Cancelled and
-- declined bookings are excluded, which is what frees their slot for rebooking.
--
-- Buffers and notice periods stay in application code: this guards the hard
-- invariant (never two people in the same slot), not the host's preferences.

-- Needed to combine an equality column with a range column in one GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduling_bookings_no_overlap'
      AND conrelid = 'public.scheduling_bookings'::regclass
  ) THEN
    ALTER TABLE public.scheduling_bookings
      ADD CONSTRAINT scheduling_bookings_no_overlap
      EXCLUDE USING gist (
        host_user_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
      ) WHERE (status IN ('pending', 'confirmed'));
  END IF;
END $$;

COMMENT ON CONSTRAINT scheduling_bookings_no_overlap ON public.scheduling_bookings IS
  'One host cannot hold two live (pending/confirmed) bookings over overlapping time. Raises 23P01, which the booking routes surface as "that time is no longer available".';
