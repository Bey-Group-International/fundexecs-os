-- 20260702200000_coupons.sql
-- Coupon codes: free-credit grants that are one-time-per-org.
-- Admins create rows in `coupons`; users redeem via the wallet page.

create table if not exists public.coupons (
  id            uuid        primary key default gen_random_uuid(),
  code          text        not null,
  credits       integer     not null check (credits > 0),
  max_uses_per_org integer  not null default 1,
  expires_at    timestamptz,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  constraint coupons_code_unique unique (code)
);

create table if not exists public.coupon_redemptions (
  id              uuid        primary key default gen_random_uuid(),
  coupon_id       uuid        not null references public.coupons(id) on delete cascade,
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  redeemed_at     timestamptz not null default now(),
  constraint coupon_redemptions_once_per_org unique (coupon_id, organization_id)
);

create index if not exists coupon_redemptions_org_idx
  on public.coupon_redemptions (organization_id);

alter table public.coupons             enable row level security;
alter table public.coupon_redemptions  enable row level security;

-- Anyone authenticated can look up an active coupon to verify it before redeeming.
create policy "coupons_active_read" on public.coupons
  for select using (is_active = true);

-- Org members can see their own redemptions.
-- NB: a set-returning function (current_principal_org_ids) may not appear
-- directly in a policy expression — Postgres raises 0A000. Use the subquery
-- form, matching every other RLS policy in this project.
create policy "coupon_redemptions_org_read" on public.coupon_redemptions
  for select using (organization_id in (select current_principal_org_ids()));

-- All writes are service-role only (no INSERT/UPDATE/DELETE for authenticated).
