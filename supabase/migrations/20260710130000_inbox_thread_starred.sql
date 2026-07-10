-- 20260710130000_inbox_thread_starred.sql
-- Star (flag) an inbox thread. Until now the board could rank, snooze, assign,
-- and mark threads read/done, but there was no way to say "keep this one in
-- front of me" independent of its triage score — the equivalent of LinkedIn's
-- starred conversations. This adds an optional boolean flag, defaulting to false
-- (unstarred), so a thread can be pinned by the operator and the saved-view
-- chips can filter to "Starred". Purely additive and reversible.

alter table public.inbox_threads
  add column if not exists starred boolean not null default false;

-- The board filters the org's threads to starred-only, so index the
-- (org, starred) pair the same way (org, assigned_to) is indexed for assignment.
create index if not exists inbox_threads_starred_idx
  on public.inbox_threads (organization_id, starred);
