-- 20260908180000_native_ach_settlement.sql
-- Native settlement machinery: debit the operator's own bank account.
--
-- Invoicing made billing native, but settling one still needed a human — an
-- operator pushing a wire and someone in finance watching for it to land. Orgs
-- already link a bank account through Financial Connections (public.linked_accounts,
-- which stores a us_bank_account payment method), and nothing used it. This lets
-- an invoice be settled by debiting that account directly, so a renewal collects
-- itself.
--
-- The important property of ACH is that it is NOT immediate and NOT final: a
-- debit is accepted, then clears (or bounces) days later. So this adds a state
-- BETWEEN issued and paid. Funds in flight are 'processing', and a period's
-- credits are still released only by 'paid' — an invoice that is merely
-- submitted has collected nothing yet, and treating it as settled would hand
-- over a period against money that can still come back.

do $$
begin
  -- 'processing' — a debit has been submitted and is clearing.
  if exists (select 1 from pg_constraint where conname = 'subscription_invoices_status_check') then
    alter table public.subscription_invoices drop constraint subscription_invoices_status_check;
  end if;
  alter table public.subscription_invoices
    add constraint subscription_invoices_status_check
    check (status in ('open', 'processing', 'paid', 'void', 'written_off'));

  -- 'ach_debit' — collected from a linked account rather than pushed to us.
  if exists (select 1 from pg_constraint where conname = 'subscription_invoices_paid_via_check') then
    alter table public.subscription_invoices drop constraint subscription_invoices_paid_via_check;
  end if;
  alter table public.subscription_invoices
    add constraint subscription_invoices_paid_via_check
    check (paid_via is null or paid_via in ('bank_transfer', 'ach_debit', 'card', 'manual', 'credit'));
end $$;

alter table public.subscription_invoices
  -- The debit in flight (a Stripe PaymentIntent). Also the idempotency anchor:
  -- an invoice that already has one is never debited a second time.
  add column if not exists settlement_intent text,
  add column if not exists settlement_started_at timestamptz,
  -- Why the last attempt bounced (R01 insufficient funds, closed account, …),
  -- kept so the operator is told something more useful than "payment failed".
  add column if not exists settlement_failure text,
  add column if not exists settlement_attempts integer not null default 0;

-- An invoice being collected is still outstanding: without 'processing' here, a
-- period whose debit is mid-flight would look unbilled and get billed again.
drop index if exists public.subscription_invoices_one_open_per_org;
create unique index subscription_invoices_one_open_per_org
  on public.subscription_invoices (organization_id)
  where status in ('open', 'processing');

-- The sweep's poll list: debits waiting to clear.
create index if not exists subscription_invoices_processing_idx
  on public.subscription_invoices (settlement_started_at)
  where status = 'processing';

-- One debit per invoice, so a retried sweep re-reads the intent it already
-- submitted instead of pulling the money twice.
create unique index if not exists subscription_invoices_settlement_intent_once
  on public.subscription_invoices (settlement_intent)
  where settlement_intent is not null;

comment on column public.subscription_invoices.settlement_intent is
  'PaymentIntent for an in-flight bank debit. Present = already submitted; never debit twice.';
comment on column public.subscription_invoices.settlement_failure is
  'Why the last debit bounced, in the operator''s words rather than a return code.';
