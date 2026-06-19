-- 0031_session_pin_unread.sql
-- Side-rail session menu (Claude Code style) gains Pin and Mark-as-unread.
-- Both are lightweight, org-scoped session state:
--   * pinned_at — when set, the session sorts to the top of the rail.
--   * unread    — a manual flag the operator can toggle to revisit later.
-- RLS already covers the sessions table (member-read / writer-write), so these
-- additive columns need no new policies.

alter table public.sessions add column pinned_at timestamptz;
alter table public.sessions add column unread boolean not null default false;

-- Pinned-first ordering for the rail's recent list.
create index sessions_pinned_idx on public.sessions (organization_id, pinned_at desc);
