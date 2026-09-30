-- When the host was reminded about a booking request still waiting on them.
--
-- An approval-gated request that nobody answers is declined automatically once
-- its time comes. Before that, the host gets one reminder, roughly a day ahead,
-- so the decline is a last resort rather than the usual outcome. This stamp is
-- what keeps it to one.
--
-- Null for every existing booking.

alter table public.scheduling_bookings
  add column if not exists host_reminded_at timestamptz;

comment on column public.scheduling_bookings.host_reminded_at is
  'When the host was reminded about this pending request; null if never.';
