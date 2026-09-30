-- Extra guests an invitee brings to a meeting booked through a public link.
--
-- A booking was one person. Someone booking an intro call for themselves and a
-- partner had to forward the confirmation by hand, and the partner then had no
-- calendar invite that would move when the meeting did, and no reminder. The
-- invitee can now list colleagues when booking; they are attendees on the
-- meeting and receive its confirmation, reschedule and cancellation emails
-- (never the invitee's manage link).
--
-- Empty for every existing booking.

alter table public.scheduling_bookings
  add column if not exists invitee_guests text[] not null default '{}'
    check (cardinality(invitee_guests) <= 10);

comment on column public.scheduling_bookings.invitee_guests is
  'Extra guest emails the invitee added, lowercased and deduplicated; at most 10.';
