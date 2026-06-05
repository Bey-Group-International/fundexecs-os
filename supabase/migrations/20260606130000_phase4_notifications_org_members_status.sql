-- =====================================================================
-- Phase 4: Core-loop persistence — additive columns + soft-delete index.
--
-- 1. `notifications.archived_at` (nullable timestamp) — needed for
--    `dismissNotification` server action without losing the row to the
--    user's history (read_at alone marks read, archived_at hides from inbox).
-- 2. `org_members.status` (text, default 'active') — pending / archived
--    workflow for `approveMember` / `archiveMember`. The current
--    handle_new_user trigger always creates active 'owner' rows, so
--    existing rows are backfilled to 'active' by the DEFAULT.
-- 3. Indexes to keep filtered notification reads + member-status filters
--    snappy.
-- =====================================================================

-- 1. notifications.archived_at -----------------------------------------
alter table public.notifications
  add column if not exists archived_at timestamp with time zone;

create index if not exists notifications_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null and archived_at is null;

create index if not exists notifications_org_archived_idx
  on public.notifications (org_id, archived_at);

-- 2. org_members.status -----------------------------------------------
alter table public.org_members
  add column if not exists status text not null default 'active';

-- Enforce the small allowed-vocab set without breaking existing rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'org_members_status_check'
  ) then
    alter table public.org_members
      add constraint org_members_status_check
      check (status in ('pending', 'active', 'archived'));
  end if;
end$$;

create index if not exists org_members_status_idx
  on public.org_members (org_id, status);

-- 3. RLS policy housekeeping -----------------------------------------
-- (No new policies needed — existing `admins manage members` covers the
--  approve / archive / role-change writes; `members view co-members`
--  covers reading the new column.)
