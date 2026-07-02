-- 20260703100000_finance_banking.sql
-- FundExecs Finance Engine — Phase 2: Banking. Native, self-hosted, zero
-- external dependencies. See docs/finance-engine/blueprint.md.
--
-- Model: a bank account is mapped to a GL cash account; statement files
-- (CSV/OFX/QIF/CAMT.053) are parsed in-app (lib/finance/banking.ts) behind a
-- pluggable adapter seam and staged as fin_bank_transactions. Auto-categorization
-- rules suggest a GL coding; the reconciliation workflow links a staged txn to a
-- journal entry (or posts a new one via the Phase-1 ledger). Amount convention:
-- money IN (deposit) is positive, money OUT is negative — the same sign as the
-- debit(+)/credit(-) the bank line takes on the cash account.

-- --- Enums ------------------------------------------------------------------
do $$ begin
  create type fin_import_format as enum ('csv','ofx','qif','camt');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_import_status as enum ('pending','staged','failed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_bank_txn_status as enum ('unmatched','suggested','matched','reconciled','ignored');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_recon_match_kind as enum ('auto','manual');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_rule_match_type as enum ('contains','exact','regex');
exception when duplicate_object then null; end $$;

-- --- Bank accounts (mapped to a GL cash account) ----------------------------
create table if not exists public.fin_bank_accounts (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_id       uuid not null references public.fin_entities (id) on delete cascade,
  gl_account_id   uuid not null references public.fin_accounts (id),   -- the cash GL account
  name            text not null,
  institution     text,
  account_mask    text,                    -- last-4 / masked account number only
  currency        char(3) not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists fin_bank_accounts_org_idx on public.fin_bank_accounts (organization_id);
create index if not exists fin_bank_accounts_entity_idx on public.fin_bank_accounts (entity_id);

-- --- Statement-file import batches ------------------------------------------
create table if not exists public.fin_bank_imports (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  bank_account_id  uuid not null references public.fin_bank_accounts (id) on delete cascade,
  format           fin_import_format not null,
  filename         text,
  checksum         text,                   -- sha256 of the file, for re-import detection
  row_count        int not null default 0,
  staged_count     int not null default 0,
  duplicate_count  int not null default 0,
  status           fin_import_status not null default 'pending',
  statement_start  date,
  statement_end    date,
  opening_balance  numeric(20,4),
  closing_balance  numeric(20,4),
  imported_by      uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists fin_bank_imports_account_idx on public.fin_bank_imports (bank_account_id, created_at);

-- --- Staged bank transactions -----------------------------------------------
create table if not exists public.fin_bank_transactions (
  id                  uuid primary key default extensions.gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  bank_account_id     uuid not null references public.fin_bank_accounts (id) on delete cascade,
  import_id           uuid references public.fin_bank_imports (id) on delete set null,
  txn_date            date not null,
  value_date          date,
  amount              numeric(20,4) not null,   -- signed; deposit +, withdrawal −
  currency            char(3) not null,
  description         text,
  counterparty        text,
  external_ref        text,                      -- bank FITID / reference, if any
  running_balance     numeric(20,4),
  dedup_hash          text not null,             -- stable hash of the txn's identity
  status              fin_bank_txn_status not null default 'unmatched',
  suggested_account_id uuid references public.fin_accounts (id) on delete set null,
  matched_entry_id    uuid references public.fin_journal_entries (id) on delete set null,
  reconciled_by       uuid references public.principals (id) on delete set null,
  reconciled_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- The same bank line must never be staged twice (re-import is idempotent).
  unique (bank_account_id, dedup_hash)
);
create index if not exists fin_bank_transactions_account_idx
  on public.fin_bank_transactions (bank_account_id, txn_date);
create index if not exists fin_bank_transactions_status_idx
  on public.fin_bank_transactions (bank_account_id, status);
create index if not exists fin_bank_transactions_org_idx on public.fin_bank_transactions (organization_id);

-- --- Auto-categorization rules ----------------------------------------------
create table if not exists public.fin_txn_rules (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  entity_id         uuid not null references public.fin_entities (id) on delete cascade,
  name              text not null,
  priority          int not null default 100,   -- lower = evaluated first
  match_type        fin_rule_match_type not null default 'contains',
  match_field       text not null default 'description', -- 'description' | 'counterparty'
  pattern           text not null,
  amount_min        numeric(20,4),
  amount_max        numeric(20,4),
  target_account_id uuid not null references public.fin_accounts (id) on delete cascade,
  counterparty      text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists fin_txn_rules_entity_idx on public.fin_txn_rules (entity_id, priority);

-- --- Reconciliations (audit trail of a txn ↔ entry match) -------------------
create table if not exists public.fin_reconciliations (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bank_account_id uuid not null references public.fin_bank_accounts (id) on delete cascade,
  bank_txn_id     uuid not null references public.fin_bank_transactions (id) on delete cascade,
  entry_id        uuid not null references public.fin_journal_entries (id),
  match_kind      fin_recon_match_kind not null default 'manual',
  matched_by      uuid references public.principals (id) on delete set null,
  matched_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  -- One reconciliation per staged txn (a txn is reconciled at most once).
  unique (bank_txn_id)
);
create index if not exists fin_reconciliations_account_idx on public.fin_reconciliations (bank_account_id);
create index if not exists fin_reconciliations_entry_idx on public.fin_reconciliations (entry_id);

-- --- updated_at triggers ----------------------------------------------------
create trigger fin_bank_accounts_set_updated_at before update on public.fin_bank_accounts
  for each row execute function public.set_updated_at();
create trigger fin_bank_imports_set_updated_at before update on public.fin_bank_imports
  for each row execute function public.set_updated_at();
create trigger fin_bank_transactions_set_updated_at before update on public.fin_bank_transactions
  for each row execute function public.set_updated_at();
create trigger fin_txn_rules_set_updated_at before update on public.fin_txn_rules
  for each row execute function public.set_updated_at();

-- --- Same-org guards (FK checks bypass RLS; keep bank refs within the org) ---
create or replace function public.fin_bank_account_same_org() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from public.fin_entities
    where id = NEW.entity_id and organization_id = NEW.organization_id
  ) then
    raise exception 'fin: bank account entity must belong to the same organization';
  end if;
  if not exists (
    select 1 from public.fin_accounts
    where id = NEW.gl_account_id
      and organization_id = NEW.organization_id
      and entity_id = NEW.entity_id
  ) then
    raise exception 'fin: bank account GL account must belong to the same organization and entity';
  end if;
  return NEW;
end $$;

drop trigger if exists fin_bank_account_same_org_trg on public.fin_bank_accounts;
create trigger fin_bank_account_same_org_trg
  before insert or update on public.fin_bank_accounts
  for each row execute function public.fin_bank_account_same_org();

-- --- RLS: member-read / writer-write org tenancy ----------------------------
alter table public.fin_bank_accounts enable row level security;
alter table public.fin_bank_imports enable row level security;
alter table public.fin_bank_transactions enable row level security;
alter table public.fin_txn_rules enable row level security;
alter table public.fin_reconciliations enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'fin_bank_accounts','fin_bank_imports','fin_bank_transactions',
    'fin_txn_rules','fin_reconciliations'
  ] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select using (organization_id in (select public.current_principal_org_ids()));',
      t);
    execute format(
      'create policy %1$s_write on public.%1$s for all using (public.is_org_writer(organization_id)) with check (public.is_org_writer(organization_id));',
      t);
  end loop;
end $$;
