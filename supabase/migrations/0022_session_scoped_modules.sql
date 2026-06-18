-- 0022_session_scoped_modules.sql
-- Per-module session-scoped data (first pass): tie the rows a session produces
-- to that session, so opening a module inside the session frame
-- (/session/[id]/[hub]/[module]) shows only that session's records, while the
-- standalone hub view (/[hub]/[module]) keeps showing the full org-wide list.
--
-- This is purely additive and backward-compatible: a nullable `session_id`
-- column on the demo-path module tables. Existing rows stay NULL (org-wide),
-- and `on delete set null` means deleting a session never deletes its records —
-- they simply fall back to the org-wide view.
--
-- Scope (key demo path): Source › Deal Pipeline (deals), Source › LP Pipeline
-- (investors), Execute › Asset Management (assets).

alter table public.deals
  add column session_id uuid references public.sessions (id) on delete set null;
create index deals_session_idx on public.deals (session_id);

alter table public.investors
  add column session_id uuid references public.sessions (id) on delete set null;
create index investors_session_idx on public.investors (session_id);

alter table public.assets
  add column session_id uuid references public.sessions (id) on delete set null;
create index assets_session_idx on public.assets (session_id);
