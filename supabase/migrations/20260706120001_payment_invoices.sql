-- 20260706120000_payment_invoices.sql
-- Payment-link invoices — a native, Stripe-backed take on link2pay's shareable
-- invoice. A firm (the merchant org) drafts an invoice with line items and gets
-- an unguessable public link (/pay/<token>). Anyone with the link pays through
-- the same Stripe Embedded Checkout the wallet already uses — no FundExecs
-- account required — and the invoice flips to `paid` on fulfillment. Fulfillment
-- is idempotent and driven by the Stripe return (plus the optional webhook),
-- exactly like `stripe_checkouts`.
--
-- Money settles to the platform's single configured Stripe account (no Stripe
-- Connect / third-party dependency); the invoice is the merchant's record and
-- the payer's receipt. Tenancy is the house pattern — member-read / writer-write
-- on organization_id — while the public pay page and fulfillment read/update by
-- token through the service role (RLS-bypassing), so an unauthenticated payer
-- resolves and pays one link without ever seeing another org's invoices.
--
-- The WICG "facilitated-payment" proposal (github.com/WICG/paymentlink) rides
-- along: `facilitated_payment_url` optionally carries a push-payment method URI
-- (upi:, bitcoin:, a wallet scheme). The pay page emits
-- <link rel="facilitated-payment" href="…"> so a compatible browser/wallet can
-- passively detect and offer that rail beside card checkout.

create table if not exists public.payment_invoices (
  id                      uuid primary key default extensions.gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  -- The public, unguessable link token. Sole gate for the /pay/<token> page.
  token                   text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  -- Human-facing invoice number, unique per org when set (e.g. INV-0001).
  number                  text,
  title                   text not null,
  description             text,
  -- Who's being billed — shown on the pay page and prefilled into Stripe.
  customer_name           text,
  customer_email          text,
  currency                text not null default 'usd',
  -- Line items: [{ description, quantity, unitAmountCents }]. The checkout amount
  -- is recomputed from these server-side, never trusted from the client.
  line_items              jsonb not null default '[]'::jsonb,
  -- Denormalized total in minor units, kept in lockstep with line_items by the
  -- writer (lib/invoices.server). Display-only; the charge recomputes from items.
  amount_cents            integer not null default 0 check (amount_cents >= 0),
  status                  text not null default 'open'
                            check (status in ('draft', 'open', 'paid', 'void')),
  -- Optional WICG facilitated-payment method URI (upi:, bitcoin:, wallet:…).
  facilitated_payment_url text,
  due_date                date,
  -- Stripe linkage recorded on payment, for reconciliation.
  stripe_session_id       text,
  stripe_payment_intent   text,
  paid_at                 timestamptz,
  created_by              uuid references public.principals (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists payment_invoices_org_idx
  on public.payment_invoices (organization_id, created_at desc);
-- Invoice number is unique within an org when present.
create unique index if not exists payment_invoices_org_number_idx
  on public.payment_invoices (organization_id, number)
  where number is not null;

drop trigger if exists payment_invoices_set_updated_at on public.payment_invoices;
create trigger payment_invoices_set_updated_at
  before update on public.payment_invoices
  for each row execute function public.set_updated_at();

-- RLS — member-read / writer-write org tenancy, as elsewhere. The public pay
-- page and Stripe fulfillment go through the service role (RLS-bypassing), so an
-- anonymous payer never needs a policy here; the token is the sole gate for them.
alter table public.payment_invoices enable row level security;

drop policy if exists payment_invoices_select on public.payment_invoices;
create policy payment_invoices_select on public.payment_invoices
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists payment_invoices_write on public.payment_invoices;
create policy payment_invoices_write on public.payment_invoices
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
