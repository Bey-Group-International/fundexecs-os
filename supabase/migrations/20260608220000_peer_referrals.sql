-- ============================================================================
-- Peer referrals — every operator gets a personal referral link.
--
-- The affiliate system (20260608200000_referrals.sql) already pays a referrer
-- 10% on a referred org's credit purchases, captured first-touch via the beta
-- link / beta invite flows. This adds a third capture source: a per-user
-- referral link (`/r/<code>`) anyone can share. A friend who follows it and
-- signs up is attributed to the sharer with `source = 'peer'`.
--
-- The per-user code maps a short, url-safe token to (user_id, org_id). The auth
-- callbacks resolve the captured code to that pair and call `record_referral`
-- with source 'peer' — which stays first-touch, idempotent, and skips
-- self/same-org, so re-running it on every sign-in is safe.
-- ============================================================================

-- ── 1) Per-user referral code ───────────────────────────────────────────────
-- One stable code per user, bound to the org whose wallet earns the commission
-- (the user's active org at the time the link was first minted).
create table if not exists public.user_referral_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists user_referral_codes_org_idx on public.user_referral_codes (org_id);

-- ── RLS — a user can read their own code row ────────────────────────────────
-- Get-or-create + the public code→owner lookup both run through the service-role
-- admin client, so the only table-level grant needed is a user reading their own
-- row (to render their link).
alter table public.user_referral_codes enable row level security;

drop policy if exists "users read their own referral code" on public.user_referral_codes;
create policy "users read their own referral code" on public.user_referral_codes
  for select to authenticated
  using (user_id = auth.uid());

-- ── 2) Allow 'peer' as a referral source ────────────────────────────────────
-- The original constraint was created inline on the referrals table, so it
-- carries the default name `referrals_source_check`. Drop-and-recreate to widen
-- the allowed set without depending on a particular Postgres version's syntax.
alter table public.referrals
  drop constraint if exists referrals_source_check;
alter table public.referrals
  add constraint referrals_source_check
  check (source in ('beta_link', 'beta_invite', 'peer'));
