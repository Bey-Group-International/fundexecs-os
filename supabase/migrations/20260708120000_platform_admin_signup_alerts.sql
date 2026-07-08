-- 20260708120000_platform_admin_signup_alerts.sql
-- Platform admin console support.
--
-- The admin console (app/admin) is an INTERNAL, cross-org surface gated to the
-- @beygroupintl.com email domain (plus an ADMIN_EMAILS allowlist). It reads
-- every org's signups + activity via the service-role client (RLS-bypassing),
-- so no new RLS policies are required here — access is enforced in the app
-- layer (lib/platform-admin.ts), never exposed to the browser.
--
-- This migration adds only what the backend needs:
--   1. principals.signup_alerted_at — an atomic "have we emailed the team about
--      this signup yet?" claim, so the new-signup alert fires exactly once
--      regardless of which auth path (email/password vs OAuth) created the user.
--   2. Reporting indexes so the activity rollups stay cheap as the user base
--      grows.

-- ---------------------------------------------------------------------------
-- 1. Exactly-once signup alert marker.
-- ---------------------------------------------------------------------------
alter table public.principals
  add column if not exists signup_alerted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Reporting indexes (idempotent). The admin rollups group signups by day
--    and attribute activity back to a principal.
-- ---------------------------------------------------------------------------
create index if not exists principals_created_at_idx
  on public.principals (created_at desc);

create index if not exists sessions_created_by_idx
  on public.sessions (created_by, created_at desc);

create index if not exists audit_log_principal_idx
  on public.audit_log (principal_id, created_at desc);
