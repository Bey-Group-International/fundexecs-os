-- 20260708170000_treasury_linked_accounts.sql
-- Treasury: linked external bank accounts + ACH money movement, on the SAME
-- single Stripe account the wallet/invoices already use — no Plaid, no Dwolla,
-- no Stripe Connect. Two tables:
--
--   linked_accounts    — an external bank account an org connected through
--                        Stripe Financial Connections (Stripe's own bank-link,
--                        the native alternative to Plaid). We store only the
--                        Stripe references + display-safe metadata (institution,
--                        last4, type, cached balance); no account/routing numbers
--                        ever touch our DB.
--   treasury_transfers — an ACH transfer against a linked account. A `deposit`
--                        pulls funds in via an ACH-debit PaymentIntent
--                        (payment_method_types: us_bank_account); a `withdrawal`
--                        pushes funds out via a Stripe payout. Status tracks the
--                        Stripe object through its lifecycle.
--
-- Tenancy is the house pattern — member-read / writer-write on organization_id.
-- Stripe fulfillment (success return + optional webhook) updates transfer status
-- through the service role, which bypasses RLS, exactly like stripe_checkouts /
-- payment_invoices — so no anonymous policy is needed here.

create table if not exists public.linked_accounts (
  id                       uuid primary key default extensions.gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete cascade,
  -- Stripe Financial Connections account id (fca_…) and the tokenized
  -- us_bank_account PaymentMethod we reuse for ACH debits (pm_…).
  stripe_fc_account_id     text,
  stripe_payment_method_id text,
  institution_name         text,
  -- A friendly label the operator sees, e.g. "Operating — Chase".
  display_name             text,
  last4                    text,
  account_type             text not null default 'checking'
                             check (account_type in ('checking', 'savings', 'other')),
  status                   text not null default 'active'
                             check (status in ('active', 'disconnected', 'errored')),
  -- Last balance Stripe reported, in minor units; refreshed opportunistically.
  balance_cents            bigint,
  currency                 text not null default 'usd',
  created_by               uuid references public.principals (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists linked_accounts_org_idx
  on public.linked_accounts (organization_id, created_at desc);
-- One row per Stripe FC account, so a re-link upserts rather than duplicates.
create unique index if not exists linked_accounts_fc_idx
  on public.linked_accounts (stripe_fc_account_id)
  where stripe_fc_account_id is not null;

drop trigger if exists linked_accounts_set_updated_at on public.linked_accounts;
create trigger linked_accounts_set_updated_at
  before update on public.linked_accounts
  for each row execute function public.set_updated_at();

alter table public.linked_accounts enable row level security;

drop policy if exists linked_accounts_select on public.linked_accounts;
create policy linked_accounts_select on public.linked_accounts
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists linked_accounts_write on public.linked_accounts;
create policy linked_accounts_write on public.linked_accounts
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create table if not exists public.treasury_transfers (
  id                       uuid primary key default extensions.gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete cascade,
  linked_account_id        uuid references public.linked_accounts (id) on delete set null,
  direction                text not null check (direction in ('deposit', 'withdrawal')),
  amount_cents             bigint not null check (amount_cents > 0),
  currency                 text not null default 'usd',
  status                   text not null default 'pending'
                             check (status in ('pending', 'processing', 'succeeded', 'failed', 'canceled')),
  -- Stripe linkage: deposits ride a PaymentIntent, withdrawals a payout.
  stripe_payment_intent_id text,
  stripe_payout_id         text,
  -- Client-supplied idempotency key, unique per org, so a double-submit is one
  -- transfer. NULL allowed (server can generate one).
  idempotency_key          text,
  description              text,
  failure_reason           text,
  created_by               uuid references public.principals (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists treasury_transfers_org_idx
  on public.treasury_transfers (organization_id, created_at desc);
create unique index if not exists treasury_transfers_idem_idx
  on public.treasury_transfers (organization_id, idempotency_key)
  where idempotency_key is not null;

drop trigger if exists treasury_transfers_set_updated_at on public.treasury_transfers;
create trigger treasury_transfers_set_updated_at
  before update on public.treasury_transfers
  for each row execute function public.set_updated_at();

alter table public.treasury_transfers enable row level security;

drop policy if exists treasury_transfers_select on public.treasury_transfers;
create policy treasury_transfers_select on public.treasury_transfers
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists treasury_transfers_write on public.treasury_transfers;
create policy treasury_transfers_write on public.treasury_transfers
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
