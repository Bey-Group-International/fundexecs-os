-- Manual "Send reminder" on a meeting.
--
-- Reminders go to real inboxes, several of them external, so the button needs a
-- guard a page refresh cannot defeat. Recording when the last one went out is
-- what makes the cooldown reliable and lets the UI say "sent 5 minutes ago"
-- rather than leaving the host guessing whether the click registered.
alter table public.live_meetings
  add column if not exists last_reminder_sent_at timestamptz;

comment on column public.live_meetings.last_reminder_sent_at is
  'When a manual reminder was last emailed to this meeting''s attendees. Drives the send-reminder cooldown.';
