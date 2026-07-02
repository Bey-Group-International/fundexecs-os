-- 20260702000016_inbox_assignment.sql
-- Assign inbox threads to a teammate. Until now a thread had a created_by but no
-- owner — so in a multi-operator firm there was no way to say "this one is
-- yours." This adds an optional assignee (a principal in the org), so threads can
-- be routed and the board can filter to "assigned to me" / "unassigned". Null =
-- unassigned (the default); set null if the assignee is removed.

alter table public.inbox_threads
  add column if not exists assigned_to uuid references public.principals (id) on delete set null;

-- The board filters the org's threads by assignee ("mine" / a teammate's), so
-- index the (org, assignee) pair the same way deal_id / investor_id are indexed.
create index if not exists inbox_threads_assigned_idx
  on public.inbox_threads (organization_id, assigned_to);
