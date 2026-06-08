-- ============================================================================
-- Recurring plan subscriptions (Stripe) + per-invoice credit-grant idempotency.
--
-- `org_subscriptions` holds the current plan/seat/status for each org. It is
-- read by org members (via private.is_org_member) and written only by the
-- service role from the Stripe webhook. `subscription_invoices` is an
-- idempotency ledger: one row per Stripe invoice we've already granted credits
-- for, so Stripe's at-least-once delivery never double-grants a renewal.
--
-- No row is auto-created for existing/new orgs: callers treat "no row" as the
-- implicit free plan (mirrors the credit_wallets `configured:false` fallback).
-- ============================================================================

create table if not exists public.org_subscriptions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  plan text not null default 'free',
  billing_interval text not null default 'month'
    check (billing_interval in ('month', 'year')),
  seats integer not null default 1 check (seats >= 1),
  status text not null default 'active'
    check (status in (
      'active', 'trialing', 'past_due', 'canceled',
      'incomplete', 'incomplete_expired', 'unpaid', 'paused'
    )),
  credits_per_period integer not null default 0 check (credits_per_period >= 0),
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_subscriptions_customer_idx
  on public.org_subscriptions (stripe_customer_id);

create table if not exists public.subscription_invoices (
  stripe_invoice_id text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  credits_granted integer not null default 0 check (credits_granted >= 0),
  period_end timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists subscription_invoices_org_idx
  on public.subscription_invoices (org_id, created_at desc);

-- Keep updated_at fresh on every write.
create or replace function public.touch_org_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_org_subscriptions_updated_at on public.org_subscriptions;
create trigger trg_org_subscriptions_updated_at
  before update on public.org_subscriptions
  for each row execute function public.touch_org_subscriptions_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security — members read, service_role writes.
-- ---------------------------------------------------------------------------
alter table public.org_subscriptions enable row level security;
alter table public.subscription_invoices enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_subscriptions'
      and policyname = 'members read org_subscriptions'
  ) then
    create policy "members read org_subscriptions" on public.org_subscriptions
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_subscriptions'
      and policyname = 'service_role insert org_subscriptions'
  ) then
    create policy "service_role insert org_subscriptions" on public.org_subscriptions
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_subscriptions'
      and policyname = 'service_role update org_subscriptions'
  ) then
    create policy "service_role update org_subscriptions" on public.org_subscriptions
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_subscriptions'
      and policyname = 'service_role delete org_subscriptions'
  ) then
    create policy "service_role delete org_subscriptions" on public.org_subscriptions
      for delete to service_role
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'subscription_invoices'
      and policyname = 'members read subscription_invoices'
  ) then
    create policy "members read subscription_invoices" on public.subscription_invoices
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'subscription_invoices'
      and policyname = 'service_role insert subscription_invoices'
  ) then
    create policy "service_role insert subscription_invoices" on public.subscription_invoices
      for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'subscription_invoices'
      and policyname = 'service_role update subscription_invoices'
  ) then
    create policy "service_role update subscription_invoices" on public.subscription_invoices
      for update to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'subscription_invoices'
      and policyname = 'service_role delete subscription_invoices'
  ) then
    create policy "service_role delete subscription_invoices" on public.subscription_invoices
      for delete to service_role
      using (true);
  end if;
end $$;
