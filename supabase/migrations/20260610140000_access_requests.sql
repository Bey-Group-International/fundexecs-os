-- ============================================================================
-- access_requests — landing-page "Request access" lead capture.
--
-- The product is invite-only, but every landing CTA used to dead-end at the
-- /login sign-in wall, so cold visitors had no way to raise their hand and we
-- captured zero leads. This table stores those hand-raises.
--
-- Submissions arrive from the UNAUTHENTICATED landing page, so the table has
-- NO anon/authenticated grants or policies at all — the only write path is
-- the service-role server action `submitAccessRequest()`
-- (lib/actions/access-request.ts), mirroring the raise_interests public-write
-- pattern (see lib/actions/raise-interest.ts). Review/triage happens through
-- service-role tooling.
--
-- One row per email (case-insensitive): a repeat submission is treated as
-- already-on-the-list by the action, not an error. Additive + idempotent.
-- ============================================================================

create table if not exists public.access_requests (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  full_name     text not null,
  firm          text not null,
  role_title    text not null,
  -- Coarse qualification band, never a precise figure.
  raising_range text not null,
  referral_code text,
  -- Where the lead came from ('landing-hero', 'landing-nav', …) for funnel attribution.
  source        text not null default 'landing',
  -- Triage state, advanced by the team during cohort review.
  status        text not null default 'new',
  created_at    timestamptz not null default now(),
  constraint access_requests_raising_range check (
    raising_range in ('lt_25m', '25_100m', '100_500m', 'gt_500m', 'undisclosed')
  ),
  constraint access_requests_status check (
    status in ('new', 'contacted', 'invited', 'declined')
  )
);

-- One request per email; the action treats a conflict as "already on the list".
create unique index if not exists access_requests_email_uniq
  on public.access_requests (lower(email));

create index if not exists access_requests_created_idx
  on public.access_requests (created_at desc);

-- RLS — no public surface at all. Reads and writes are service-role only.
alter table public.access_requests enable row level security;

revoke all on table public.access_requests from anon, authenticated;
grant select, insert, update, delete on table public.access_requests to service_role;
