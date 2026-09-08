-- 20260908160000_subscription_invoices.sql
-- Invoice-settled subscriptions: the native billing path.
--
-- Until now a subscription period was settled by charging a card, and the
-- "native" rail settled by doing nothing — fine for a demo, but it means a
-- deployment without a processor hands out paid plans. This makes invoicing the
-- primary way a period is paid for: each period issues an invoice the operator
-- settles by bank transfer, and the period's credits are granted when that
-- payment is confirmed. A card is the FALLBACK, used when the invoice has not
-- been settled by its due date (or when there is no native method at all).
--
-- This is deliberately NOT public.payment_invoices. That table is a firm
-- invoicing its OWN clients — its organization_id is the merchant collecting the
-- money, and /pay/<token> treats it that way. A subscription bill runs the other
-- direction, so storing one there would file our bill to an operator inside
-- their own outgoing invoice list.

create table if not exists public.subscription_invoices (
  id                   uuid primary key default extensions.gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  subscription_id      uuid references public.subscriptions (id) on delete set null,

  -- Human-facing reference an operator can quote on a wire (FX-202609-00001).
  number               text not null unique,

  -- The period this invoice buys. Credits are granted for it on payment, so the
  -- amounts are frozen here rather than re-derived from a plan table that may
  -- have been re-priced since.
  plan                 text not null,
  interval             text not null,
  period_start         timestamptz not null,
  period_end           timestamptz not null,
  amount_usd           numeric(10,2) not null check (amount_usd >= 0),
  credits              integer not null default 0 check (credits >= 0),

  -- open      — issued, awaiting settlement
  -- paid      — funds confirmed; the period has been (or is about to be) applied
  -- void      — withdrawn (plan changed, subscription cancelled before payment)
  -- written_off — never settled; the subscription closed over it
  status               text not null default 'open',

  -- Net terms. Access continues while an invoice is open and not yet overdue;
  -- past this date the card fallback runs, and failing that, dunning starts.
  issued_at            timestamptz not null default now(),
  due_at               timestamptz not null,
  paid_at              timestamptz,

  -- How it actually settled, for reconciliation: bank_transfer | card | manual | credit
  paid_via             text,
  -- Wire reference, Stripe PaymentIntent, or whatever identifies the settlement.
  payment_reference    text,
  -- Set once the period's credits have been granted, so a re-run of the sweep
  -- (or a double mark-paid) can never grant the same period twice.
  applied_at           timestamptz,

  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_status_check') then
    alter table public.subscription_invoices
      add constraint subscription_invoices_status_check
      check (status in ('open', 'paid', 'void', 'written_off'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_paid_via_check') then
    alter table public.subscription_invoices
      add constraint subscription_invoices_paid_via_check
      check (paid_via is null or paid_via in ('bank_transfer', 'card', 'manual', 'credit'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_period_check') then
    alter table public.subscription_invoices
      add constraint subscription_invoices_period_check
      check (period_end > period_start);
  end if;

  -- A paid invoice must say when and how; an unpaid one must not claim to have.
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_paid_shape_check') then
    alter table public.subscription_invoices
      add constraint subscription_invoices_paid_shape_check
      check (
        (status = 'paid' and paid_at is not null and paid_via is not null)
        or (status <> 'paid' and paid_at is null)
      );
  end if;
end $$;

-- One invoice per subscription period. This is what makes issuance idempotent:
-- a sweep that runs twice re-finds the invoice instead of billing twice.
create unique index if not exists subscription_invoices_period_once
  on public.subscription_invoices (subscription_id, period_start)
  where status <> 'void';

-- …and one OPEN invoice per organization, full stop.
--
-- The index above cannot carry this alone: a first purchase is billed BEFORE the
-- subscription exists, so its subscription_id is null, and Postgres treats nulls
-- as distinct in a unique index. Two clicks on "choose a plan" therefore produced
-- two bills for the same thing. This index does not depend on a nullable column,
-- and it also encodes the rule the billing flow actually wants: an operator is
-- never chasing more than one outstanding subscription bill at a time.
create unique index if not exists subscription_invoices_one_open_per_org
  on public.subscription_invoices (organization_id)
  where status = 'open';

-- The sweep's driving queries: what is outstanding, and what has been paid but
-- not yet applied.
create index if not exists subscription_invoices_open_idx
  on public.subscription_invoices (due_at)
  where status = 'open';
create index if not exists subscription_invoices_unapplied_idx
  on public.subscription_invoices (paid_at)
  where status = 'paid' and applied_at is null;
create index if not exists subscription_invoices_org_idx
  on public.subscription_invoices (organization_id, issued_at desc);

drop trigger if exists subscription_invoices_set_updated_at on public.subscription_invoices;
create trigger subscription_invoices_set_updated_at
  before update on public.subscription_invoices
  for each row execute function public.set_updated_at();

-- Invoice numbers come from a sequence so two concurrent issuances can't collide.
create sequence if not exists public.subscription_invoice_number_seq;

create or replace function public.next_subscription_invoice_number()
returns text language sql volatile as $$
  select 'FX-' || to_char(now(), 'YYYYMM') || '-' ||
         lpad(nextval('public.subscription_invoice_number_seq')::text, 5, '0');
$$;

-- RLS: an org reads its own bills; nothing writes through the API. Marking an
-- invoice paid moves money-equivalent value (a period's credits), so it is
-- service-role only — see lib/subscription-invoices.server.
alter table public.subscription_invoices enable row level security;

drop policy if exists subscription_invoices_select on public.subscription_invoices;
create policy subscription_invoices_select on public.subscription_invoices
  for select using (organization_id in (select public.current_principal_org_ids()));

comment on table public.subscription_invoices is
  'FundExecs → organization subscription billing. Native settlement is a bank transfer against these; a card is the fallback when one goes overdue.';
comment on column public.subscription_invoices.applied_at is
  'When this period''s credits were granted. Set once — the guard against granting a period twice.';
comment on column public.subscription_invoices.status is
  'open | paid | void | written_off. Access continues while open and not overdue.';
