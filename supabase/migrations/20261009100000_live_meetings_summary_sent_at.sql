-- 20261009100000_live_meetings_summary_sent_at.sql
-- When a meeting's summary email first went out.
--
-- The "Email to attendees" button had no memory. The route read the report,
-- mailed everyone and recorded an inbox thread per person — and a second press
-- did exactly the same thing again. A host who did not see the confirmation,
-- or saw it and pressed again to be sure, sent every attendee a duplicate and
-- doubled the threads on the meeting. Nothing anywhere said it had already
-- been done.
--
-- One timestamp on the meeting row, written by the email route after a send
-- that reached at least one person. A second press reads it and answers with
-- when it went rather than with more mail, unless the host asks to resend.
--
-- A column rather than a lookup on the inbox threads it already writes, for
-- two reasons: the threads are written with the service role and are not
-- readable from every path that needs this answer, and a thread can exist
-- for a meeting whose summary was never sent (the follow-up writes the same
-- threads).
--
-- RLS: live_meetings' existing policies apply. The update policy is
-- `host_id = auth.uid()`, which is exactly who may send the summary.

alter table public.live_meetings
  add column if not exists summary_sent_at timestamptz;

comment on column public.live_meetings.summary_sent_at is
  'When the meeting summary was first emailed to its attendees. Written by the report email route; a later send without an explicit resend is refused.';
