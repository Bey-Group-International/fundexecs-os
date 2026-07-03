-- 20260703120000_finance_arap.sql
-- FundExecs Finance Engine — Phase 3: Accounts Receivable / Accounts Payable.
-- Native, self-hosted, zero external dependencies. See docs/finance-engine/
-- blueprint.md.
--
-- Model: customer/vendor master (fin_parties) → invoices (AR) and bills (AP)
-- unified in fin_invoices (by `kind`) with typed lines → payments allocated
-- across invoices (fin_payment_allocations). Invoice/line/payment money is 2dp.
-- Posting to the GL (AR/AP control accounts) is done by the server action via
-- the Phase-1 ledger; the posted entry id is recorded back here.

-- --- Enums ------------------------------------------------------------------
do $$ begin
  create type fin_party_kind as enum ('customer','vendor','both');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_invoice_kind as enum ('receivable','payable');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_invoice_status as enum ('draft','open','partial','paid','void');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_payment_direction as enum ('inbound','outbound');
exception when duplicate_object then null; end $$;

-- --- Customer / vendor master ----------------------------------------------
create table if not exists public.fin_parties (
  id                    uuid primary key default extensions.gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  entity_id             uuid not null references public.fin_entities (id) on delete cascade,
  kind                  fin_party_kind not null,
  name                  text not null,
  email                 text,
  tax_id                text,
  -- Control accounts this party posts through (null = use the entity default).
  ar_control_account_id uuid references public.fin_accounts (id) on delete set null,
  ap_control_account_id uuid references public.fin_accounts (id) on delete set null,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists fin_parties_org_idx on public.fin_parties (organization_id);
create index if not exists fin_parties_entity_idx on public.fin_parties (entity_id);

-- --- Invoices (AR) and bills (AP), unified by `kind` ------------------------
create table if not exists public.fin_invoices (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_id       uuid not null references public.fin_entities (id) on delete cascade,
  party_id        uuid not null references public.fin_parties (id),
  kind            fin_invoice_kind not null,
  invoice_no      text not null,
  issue_date      date not null,
  due_date        date not null,
  currency        char(3) not null,
  subtotal        numeric(20,2) not null default 0,
  tax             numeric(20,2) not null default 0,
  total           numeric(20,2) not null default 0,
  amount_paid     numeric(20,2) not null default 0,
  status          fin_invoice_status not null default 'draft',
  memo            text,
  posted_entry_id uuid references public.fin_journal_entries (id) on delete set null,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (entity_id, kind, invoice_no)
);
create index if not exists fin_invoices_org_idx on public.fin_invoices (organization_id);
create index if not exists fin_invoices_party_idx on public.fin_invoices (party_id);
create index if not exists fin_invoices_status_idx on public.fin_invoices (entity_id, kind, status, due_date);

create table if not exists public.fin_invoice_lines (
  id            uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id    uuid not null references public.fin_invoices (id) on delete cascade,
  line_no       int not null,
  description   text not null,
  quantity      numeric(20,4) not null default 1,
  unit_price    numeric(20,4) not null default 0,
  tax_rate      numeric(9,6) not null default 0,   -- fraction (0.2 = 20%)
  income_account_id uuid references public.fin_accounts (id) on delete set null,
  line_subtotal numeric(20,2) not null default 0,
  line_tax      numeric(20,2) not null default 0,
  line_total    numeric(20,2) not null default 0,
  unique (invoice_id, line_no)
);
create index if not exists fin_invoice_lines_invoice_idx on public.fin_invoice_lines (invoice_id);

-- --- Payments and their allocation across invoices -------------------------
create table if not exists public.fin_payments (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_id       uuid not null references public.fin_entities (id) on delete cascade,
  party_id        uuid not null references public.fin_parties (id),
  direction       fin_payment_direction not null,
  payment_date    date not null,
  currency        char(3) not null,
  amount          numeric(20,2) not null,
  memo            text,
  bank_account_id uuid references public.fin_bank_accounts (id) on delete set null,
  posted_entry_id uuid references public.fin_journal_entries (id) on delete set null,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists fin_payments_org_idx on public.fin_payments (organization_id);
create index if not exists fin_payments_party_idx on public.fin_payments (party_id);

create table if not exists public.fin_payment_allocations (
  id            uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payment_id    uuid not null references public.fin_payments (id) on delete cascade,
  invoice_id    uuid not null references public.fin_invoices (id) on delete cascade,
  amount        numeric(20,2) not null,
  created_at    timestamptz not null default now(),
  unique (payment_id, invoice_id)
);
create index if not exists fin_payment_allocations_invoice_idx on public.fin_payment_allocations (invoice_id);

-- --- updated_at triggers (drop-then-create so a re-apply is idempotent) ------
drop trigger if exists fin_parties_set_updated_at on public.fin_parties;
create trigger fin_parties_set_updated_at before update on public.fin_parties
  for each row execute function public.set_updated_at();
drop trigger if exists fin_invoices_set_updated_at on public.fin_invoices;
create trigger fin_invoices_set_updated_at before update on public.fin_invoices
  for each row execute function public.set_updated_at();
drop trigger if exists fin_payments_set_updated_at on public.fin_payments;
create trigger fin_payments_set_updated_at before update on public.fin_payments
  for each row execute function public.set_updated_at();

-- --- Same-org guards (FK checks bypass RLS) --------------------------------
create or replace function public.fin_party_same_org() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from public.fin_entities
    where id = NEW.entity_id and organization_id = NEW.organization_id
  ) then
    raise exception 'fin: party entity must belong to the same organization';
  end if;
  return NEW;
end $$;

drop trigger if exists fin_party_same_org_trg on public.fin_parties;
create trigger fin_party_same_org_trg
  before insert or update on public.fin_parties
  for each row execute function public.fin_party_same_org();

create or replace function public.fin_invoice_same_org() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from public.fin_parties
    where id = NEW.party_id
      and organization_id = NEW.organization_id
      and entity_id = NEW.entity_id
  ) then
    raise exception 'fin: invoice party must belong to the same organization and entity';
  end if;
  return NEW;
end $$;

drop trigger if exists fin_invoice_same_org_trg on public.fin_invoices;
create trigger fin_invoice_same_org_trg
  before insert or update on public.fin_invoices
  for each row execute function public.fin_invoice_same_org();

create or replace function public.fin_payment_same_org() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from public.fin_parties
    where id = NEW.party_id
      and organization_id = NEW.organization_id
      and entity_id = NEW.entity_id
  ) then
    raise exception 'fin: payment party must belong to the same organization and entity';
  end if;
  return NEW;
end $$;

drop trigger if exists fin_payment_same_org_trg on public.fin_payments;
create trigger fin_payment_same_org_trg
  before insert or update on public.fin_payments
  for each row execute function public.fin_payment_same_org();

-- --- Atomic payment application --------------------------------------------
-- Insert a payment, insert its allocations, and bump each allocated invoice's
-- amount_paid + recompute status — all in one transaction. p_payment carries the
-- payment columns; p_allocations is [{ invoiceId, amount }, …]. security invoker
-- so RLS governs every write. Returns the new payment id.
create or replace function public.fin_apply_payment(
  p_payment jsonb, p_allocations jsonb, p_actor uuid
) returns uuid
language plpgsql security invoker as $$
declare
  v_org uuid; v_payment uuid; alloc jsonb; v_inv uuid; v_amt numeric(20,2);
  v_total numeric(20,2); v_paid numeric(20,2);
begin
  v_org := (p_payment->>'organizationId')::uuid;
  insert into public.fin_payments
    (organization_id, entity_id, party_id, direction, payment_date, currency,
     amount, memo, bank_account_id, created_by)
  values (
    v_org, (p_payment->>'entityId')::uuid, (p_payment->>'partyId')::uuid,
    (p_payment->>'direction')::fin_payment_direction, (p_payment->>'paymentDate')::date,
    p_payment->>'currency', (p_payment->>'amount')::numeric,
    p_payment->>'memo', nullif(p_payment->>'bankAccountId','')::uuid, p_actor)
  returning id into v_payment;

  for alloc in select jsonb_array_elements(p_allocations) loop
    v_inv := (alloc->>'invoiceId')::uuid;
    v_amt := (alloc->>'amount')::numeric;
    insert into public.fin_payment_allocations (organization_id, payment_id, invoice_id, amount)
    values (v_org, v_payment, v_inv, v_amt);
    update public.fin_invoices
      set amount_paid = amount_paid + v_amt
      where id = v_inv
      returning total, amount_paid into v_total, v_paid;
    update public.fin_invoices
      set status = case
        when v_paid >= v_total and v_total > 0 then 'paid'::fin_invoice_status
        when v_paid > 0 then 'partial'::fin_invoice_status
        else 'open'::fin_invoice_status end
      where id = v_inv and status <> 'void';
  end loop;

  return v_payment;
end $$;

-- --- RLS: member-read / writer-write org tenancy ----------------------------
alter table public.fin_parties enable row level security;
alter table public.fin_invoices enable row level security;
alter table public.fin_invoice_lines enable row level security;
alter table public.fin_payments enable row level security;
alter table public.fin_payment_allocations enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'fin_parties','fin_invoices','fin_invoice_lines','fin_payments','fin_payment_allocations'
  ] loop
    -- drop-then-create so a preview-branch reset / re-apply is idempotent.
    execute format('drop policy if exists %1$s_select on public.%1$s;', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select using (organization_id in (select public.current_principal_org_ids()));',
      t);
    execute format('drop policy if exists %1$s_write on public.%1$s;', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all using (public.is_org_writer(organization_id)) with check (public.is_org_writer(organization_id));',
      t);
  end loop;
end $$;
