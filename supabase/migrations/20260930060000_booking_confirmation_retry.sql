-- Retry a booking confirmation the invitee never received.
--
-- A booking made through a public link is confirmed by one email to a
-- stranger: it carries their join link, their manage link and the calendar
-- invite. When that send fails — the host has no mailbox, or the mail provider
-- is refusing (as it did for every org when the app's Google OAuth client was
-- deleted) — the invitee has nothing, and nothing ever tried again.
--
-- The book route now marks such a booking, and the hourly cron re-sends the
-- invitee's copy until it goes through, the booking stops being live, the
-- meeting starts, or the attempt budget runs out.

alter table public.scheduling_bookings
  add column if not exists confirmation_email_pending boolean not null default false,
  add column if not exists confirmation_email_attempts smallint not null default 0;

comment on column public.scheduling_bookings.confirmation_email_pending is
  'True while the invitee''s booking confirmation has not been delivered; the cron retries it.';
comment on column public.scheduling_bookings.confirmation_email_attempts is
  'Retries spent on confirmation_email_pending. Doubles as the claim token between overlapping sweeps.';

-- The sweep reads only flagged rows, soonest first; almost none are flagged.
create index if not exists scheduling_bookings_confirmation_retry_idx
  on public.scheduling_bookings (starts_at)
  where confirmation_email_pending;
