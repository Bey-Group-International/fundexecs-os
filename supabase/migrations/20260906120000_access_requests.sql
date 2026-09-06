-- 20260906120000_access_requests.sql
-- Invite-only entry. Self-serve account creation is removed: a prospective
-- operator submits an access request, an internal platform admin approves it,
-- and only an approved principal can complete a sign-in.
--
-- Two pieces:
--   1. public.access_requests — the queue itself. Written by the public
--      /request-access server action through the SERVICE-ROLE client and read
--      only by the platform-admin console, so it carries RLS with no policies:
--      anon and authenticated get nothing, service-role bypasses. That is the
--      same posture the admin reporting reads already take (lib/admin/reports).
--   2. principals.access_approved_at — the gate the auth paths check. Every
--      principal that exists TODAY is backfilled as approved, so this migration
--      can never lock out a current user; only accounts created after it land
--      unapproved and get bounced to /request-access.

-- ---------------------------------------------------------------------------
-- 1. The request queue.
-- ---------------------------------------------------------------------------
create table if not exists public.access_requests (
  id           uuid primary key default extensions.gen_random_uuid(),
  -- Stored normalized (lower/trimmed) so the unique constraint dedupes repeat
  -- requests from the same person; the app normalizes before every write.
  email        text not null unique check (email = lower(email)),
  full_name    text,
  firm         text,
  role         text,
  note         text,
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'declined')),
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.principals (id) on delete set null,
  -- Exactly-once claim for the internal "new access request" alert, mirroring
  -- principals.signup_alerted_at.
  alerted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists access_requests_status_idx
  on public.access_requests (status, created_at desc);

drop trigger if exists access_requests_set_updated_at on public.access_requests;
create trigger access_requests_set_updated_at
  before update on public.access_requests
  for each row execute function public.set_updated_at();

-- RLS on with NO policies: the queue is reachable only through the service-role
-- client behind the platform-admin gate (lib/platform-admin.ts). A browser
-- session — signed in or not — sees an empty table and cannot write to it.
alter table public.access_requests enable row level security;

revoke all on public.access_requests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The sign-in gate on principals.
-- ---------------------------------------------------------------------------
alter table public.principals
  add column if not exists access_approved_at timestamptz;

-- Backfill: everyone who already has an account keeps it. Only principals
-- created from here on start unapproved.
update public.principals
   set access_approved_at = coalesce(created_at, now())
 where access_approved_at is null;
