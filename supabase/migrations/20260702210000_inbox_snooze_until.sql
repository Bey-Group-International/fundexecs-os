-- 20260702000017_inbox_snooze_until.sql
-- Snooze-until-time for inbox threads. Until now "snooze" only cleared the
-- unread flag — the thread never actually left the board. This adds a wake time:
-- a snoozed thread is hidden from the active board until snoozed_until passes,
-- then auto-returns to open on the next read (lib/inbox/data.autoUnsnoozeExpired).
-- Null while a thread isn't snoozed to a time.

alter table public.inbox_threads
  add column if not exists snoozed_until timestamptz;

-- The read path wakes expired snoozes with a single org-scoped update over
-- (status='snoozed', snoozed_until <= now()), so index that shape.
create index if not exists inbox_threads_snoozed_until_idx
  on public.inbox_threads (organization_id, status, snoozed_until);
