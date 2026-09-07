-- 20260907160000_native_subscriptions.sql
-- Native subscription lifecycle.
--
-- Until now a "plan" was three columns on `wallets` (plan, plan_interval,
-- plan_started_at) set at checkout and never touched again. Nothing recorded
-- when the period ended, whether the next charge succeeded, or that the operator
-- had cancelled — so a cancelled plan stayed active forever, a plan change
-- opened a SECOND subscription, and renewals only happened if an optional
-- Stripe webhook was wired.
--
-- This makes FundExecs the system of record. `subscriptions` holds the billing
-- period and its state machine; `subscription_events` is the append-only
-- billing history. A payment processor becomes just a charge rail: the native
-- rail settles in-app, Stripe (when configured) charges the saved card
-- off-session. The renewal sweep (/api/cron) drives every cycle either way.

-- 1) subscriptions ---------------------------------------------------------
create table if not exists public.subscriptions (
  id                      uuid primary key default extensions.gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,

  plan                    text not null,                       -- starter | pro | scale
  interval                text not null default 'monthly',     -- monthly | annual
  status                  text not null default 'active',      -- active | past_due | canceled

  -- USD charged per period. Denormalized from lib/billing at purchase so a later
  -- price change never silently re-prices an existing subscriber.
  price_usd               numeric(10,2) not null default 0,

  current_period_start    timestamptz not null default now(),
  current_period_end      timestamptz not null,

  -- Cancellation is always end-of-period: access is paid for, so it is never cut
  -- off mid-cycle. The sweep closes the subscription when the period expires.
  cancel_at_period_end    boolean not null default false,
  canceled_at             timestamptz,
  ended_at                timestamptz,

  -- A downgrade takes effect at renewal (no clawback of credits already granted
  -- and possibly spent). Upgrades apply immediately and prorate, so they never
  -- land here.
  pending_plan            text,
  pending_interval        text,

  -- Dunning. A failed off-session charge moves the row to past_due and schedules
  -- a retry; after PAST_DUE_MAX_ATTEMPTS the subscription closes.
  failed_attempts         integer not null default 0,
  last_payment_error      text,
  next_attempt_at         timestamptz,

  -- Which rail settles the charge: 'native' (in-app, no processor) or 'stripe'.
  processor               text not null default 'native',
  processor_customer_id   text,
  -- Set only for legacy Stripe-managed (mode=subscription) rows: Stripe bills
  -- those on its own schedule, so the renewal sweep leaves them alone.
  processor_subscription_id text,

  started_at              timestamptz not null default now(),
  created_by              uuid references public.principals (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Constraints are added conditionally so this migration is safe to re-apply
-- against a database that already has the table (matching `create table if not
-- exists` above); `add constraint` has no IF NOT EXISTS form.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_plan_check') then
    alter table public.subscriptions
      add constraint subscriptions_plan_check check (plan in ('starter', 'pro', 'scale'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscriptions_interval_check') then
    alter table public.subscriptions
      add constraint subscriptions_interval_check check (interval in ('monthly', 'annual'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscriptions_status_check') then
    alter table public.subscriptions
      add constraint subscriptions_status_check check (status in ('active', 'past_due', 'canceled'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscriptions_pending_plan_check') then
    alter table public.subscriptions
      add constraint subscriptions_pending_plan_check
      check (pending_plan is null or pending_plan in ('starter', 'pro', 'scale'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscriptions_pending_interval_check') then
    alter table public.subscriptions
      add constraint subscriptions_pending_interval_check
      check (pending_interval is null or pending_interval in ('monthly', 'annual'));
  end if;

  -- A period that ends before it starts is a bug that would renew forever.
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_period_check') then
    alter table public.subscriptions
      add constraint subscriptions_period_check
      check (current_period_end > current_period_start);
  end if;
end $$;

-- At most ONE live subscription per org. This is the constraint that makes the
-- old double-billing bug (plan change = second subscription) unrepresentable.
create unique index if not exists subscriptions_one_live_per_org
  on public.subscriptions (organization_id)
  where status in ('active', 'past_due');

-- The renewal sweep's driving query: live rows whose period has elapsed.
create index if not exists subscriptions_due_idx
  on public.subscriptions (current_period_end)
  where status in ('active', 'past_due');

create index if not exists subscriptions_org_idx
  on public.subscriptions (organization_id, created_at desc);

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- 2) subscription_events ---------------------------------------------------
-- Append-only billing history: what happened, when, and what it cost. This is
-- the record the Wallet page renders and the audit trail for every charge the
-- native rail settles.
create table if not exists public.subscription_events (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete cascade,

  -- created | renewed | upgraded | downgrade_scheduled | downgrade_applied
  -- | canceled | resumed | payment_failed | ended
  kind            text not null,
  plan            text,
  interval        text,
  amount_usd      numeric(10,2) not null default 0,
  credits_granted integer not null default 0,
  -- Rail reference for the settled charge (Stripe PaymentIntent id, or a
  -- native_… id), so every grant traces back to a payment.
  reference       text,
  note            text,
  created_at      timestamptz not null default now()
);

create index if not exists subscription_events_org_idx
  on public.subscription_events (organization_id, created_at desc);
create index if not exists subscription_events_sub_idx
  on public.subscription_events (subscription_id, created_at desc);

-- One renewal per period, enforced by the database rather than by hoping two
-- overlapping cron sweeps never overlap.
create unique index if not exists subscription_events_renewal_once
  on public.subscription_events (subscription_id, reference)
  where kind = 'renewed';

-- 3) wallets: the saved payment instrument -------------------------------
-- Needed to charge an off-session renewal without the operator present. Only the
-- processor's token is stored — never card data.
alter table public.wallets
  add column if not exists stripe_payment_method_id text;

-- 4) RLS -------------------------------------------------------------------
-- Same org tenancy as wallets. Writes are service-role only: a member must never
-- be able to hand themselves a period extension or a plan, so there is no write
-- policy at all — every mutation goes through lib/subscriptions.server.
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists subscription_events_select on public.subscription_events;
create policy subscription_events_select on public.subscription_events
  for select using (organization_id in (select public.current_principal_org_ids()));

-- 5) Back-fill -------------------------------------------------------------
-- Existing plan holders (wallets.plan set by the old checkout) become active
-- subscriptions so they keep their entitlement and start renewing. Their period
-- starts NOW rather than at plan_started_at: we have no record of which periods
-- were already served, and starting fresh can only ever delay a charge, never
-- bill someone early. Loyalty tenure still runs from wallets.plan_started_at.
insert into public.subscriptions (
  organization_id, plan, interval, status, price_usd,
  current_period_start, current_period_end, started_at, processor
)
select
  w.organization_id,
  w.plan,
  case when w.plan_interval = 'annual' then 'annual' else 'monthly' end,
  'active',
  0,  -- unknown historical price; the next renewal re-prices from lib/billing
  now(),
  now() + case when w.plan_interval = 'annual' then interval '1 year' else interval '1 month' end,
  coalesce(w.plan_started_at, w.updated_at, now()),
  case when w.stripe_customer_id is not null then 'stripe' else 'native' end
from public.wallets w
where w.plan in ('starter', 'pro', 'scale')
  and not exists (
    select 1 from public.subscriptions x
    where x.organization_id = w.organization_id
      and x.status in ('active', 'past_due')
  );

comment on table public.subscriptions is
  'Native subscription lifecycle — FundExecs owns the billing period and state; a processor is only a charge rail.';
comment on column public.subscriptions.pending_plan is
  'Downgrade scheduled for the next renewal. Upgrades apply immediately (prorated) and never set this.';
comment on column public.subscriptions.processor_subscription_id is
  'Legacy Stripe-managed subscription. Set = Stripe bills it; the renewal sweep skips the row.';
comment on table public.subscription_events is
  'Append-only billing history: every charge, grant, plan change and cancellation.';
