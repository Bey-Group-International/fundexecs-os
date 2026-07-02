-- 20260702220000_finance_ledger_foundation.sql
-- FundExecs Finance Engine — Phase 1: the immutable double-entry ledger core.
-- Native, self-hosted, zero external dependencies. See docs/finance-engine/
-- blueprint.md for the full architecture and the phased build plan.
--
-- Model: multi-entity (each with a base currency) -> multi-ledger (books) ->
-- hierarchical typed chart of accounts -> append-only balanced journal entries.
-- Signed-amount convention: debit > 0, credit < 0; a balanced entry sums to 0.
-- Postings are immutable once posted (corrections are reversing entries),
-- enforced in the database, not just the app.

-- --- Enums ------------------------------------------------------------------
do $$ begin
  create type fin_account_type as enum ('asset','liability','equity','income','expense');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_normal_side as enum ('debit','credit');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_period_status as enum ('open','closed','locked');
exception when duplicate_object then null; end $$;
do $$ begin
  create type fin_entry_status as enum ('draft','posted','reversed','reversal','void');
exception when duplicate_object then null; end $$;

-- --- Entities & ledgers -----------------------------------------------------
create table if not exists public.fin_entities (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  base_currency    char(3) not null,
  parent_entity_id uuid references public.fin_entities (id) on delete set null,
  tax_jurisdiction text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists fin_entities_org_idx on public.fin_entities (organization_id);

create table if not exists public.fin_ledgers (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_id       uuid not null references public.fin_entities (id) on delete cascade,
  code            text not null,                 -- 'actual' | 'budget' | 'tax'
  currency        char(3) not null,
  is_primary      boolean not null default false,
  -- Monotonic entry number source for this ledger, bumped at post time.
  entry_seq       bigint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (entity_id, code)
);
create index if not exists fin_ledgers_org_idx on public.fin_ledgers (organization_id);

-- --- Chart of accounts ------------------------------------------------------
create table if not exists public.fin_accounts (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  entity_id         uuid not null references public.fin_entities (id) on delete cascade,
  code              text not null,
  name              text not null,
  type              fin_account_type not null,
  normal_side       fin_normal_side not null,
  parent_account_id uuid references public.fin_accounts (id) on delete set null,
  is_control        boolean not null default false,
  is_active         boolean not null default true,
  currency          char(3),                     -- null = entity base currency
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (entity_id, code)
);
create index if not exists fin_accounts_org_idx on public.fin_accounts (organization_id);
create index if not exists fin_accounts_entity_idx on public.fin_accounts (entity_id);

-- --- Accounting periods -----------------------------------------------------
create table if not exists public.fin_periods (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_id       uuid not null references public.fin_entities (id) on delete cascade,
  starts_on       date not null,
  ends_on         date not null,
  status          fin_period_status not null default 'open',
  closed_by       uuid references public.principals (id) on delete set null,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (entity_id, starts_on, ends_on)
);
create index if not exists fin_periods_entity_idx on public.fin_periods (entity_id, starts_on, ends_on);

-- --- FX rates ---------------------------------------------------------------
create table if not exists public.fin_fx_rates (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  as_of           date not null,
  from_ccy        char(3) not null,
  to_ccy          char(3) not null,
  rate            numeric(20,10) not null,
  primary key (organization_id, as_of, from_ccy, to_ccy)
);

-- --- Journal (append-only core) ---------------------------------------------
create table if not exists public.fin_journal_entries (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  ledger_id         uuid not null references public.fin_ledgers (id) on delete cascade,
  entity_id         uuid not null references public.fin_entities (id) on delete cascade,
  period_id         uuid not null references public.fin_periods (id),
  entry_no          bigint,                      -- assigned from ledger.entry_seq on post
  entry_date        date not null,
  memo              text,
  source            text not null default 'manual', -- manual|invoice|payment|bank|fx|system
  source_ref        uuid,
  status            fin_entry_status not null default 'draft',
  reverses_entry_id uuid references public.fin_journal_entries (id),
  posted_by         uuid references public.principals (id) on delete set null,
  posted_at         timestamptz,
  hash              text,                        -- tamper-evident chain (app-computed)
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists fin_journal_entries_org_idx on public.fin_journal_entries (organization_id);
create index if not exists fin_journal_entries_ledger_idx
  on public.fin_journal_entries (ledger_id, entry_date);
create index if not exists fin_journal_entries_period_idx on public.fin_journal_entries (period_id);

create table if not exists public.fin_journal_lines (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entry_id        uuid not null references public.fin_journal_entries (id) on delete cascade,
  account_id      uuid not null references public.fin_accounts (id),
  line_no         int not null,
  currency        char(3) not null,             -- transaction currency
  amount          numeric(20,4) not null,       -- signed, txn ccy (debit +, credit -)
  base_amount     numeric(20,4) not null,       -- signed, entity base ccy
  fx_rate         numeric(20,10) not null default 1,
  memo            text,
  created_at      timestamptz not null default now(),
  unique (entry_id, line_no)
);
create index if not exists fin_journal_lines_entry_idx on public.fin_journal_lines (entry_id);
create index if not exists fin_journal_lines_account_idx on public.fin_journal_lines (account_id);

-- --- updated_at triggers ----------------------------------------------------
create trigger fin_entities_set_updated_at before update on public.fin_entities
  for each row execute function public.set_updated_at();
create trigger fin_ledgers_set_updated_at before update on public.fin_ledgers
  for each row execute function public.set_updated_at();
create trigger fin_accounts_set_updated_at before update on public.fin_accounts
  for each row execute function public.set_updated_at();
create trigger fin_periods_set_updated_at before update on public.fin_periods
  for each row execute function public.set_updated_at();
create trigger fin_journal_entries_set_updated_at before update on public.fin_journal_entries
  for each row execute function public.set_updated_at();

-- --- Immutability: a posted entry (and its lines) can never change ----------
create or replace function public.fin_journal_entry_immutable() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.status <> 'draft' then
      raise exception 'fin: posted journal entry % is immutable (delete blocked)', OLD.id;
    end if;
    return OLD;
  end if;
  -- UPDATE. A draft entry is freely mutable (it is not in the ledger yet).
  if OLD.status = 'draft' then
    return NEW;
  end if;
  -- The only permitted change to a non-draft entry is marking a posted entry
  -- 'reversed' (when its reversal is created). Everything else is blocked.
  if OLD.status = 'posted' and NEW.status = 'reversed'
     and NEW.entry_no is not distinct from OLD.entry_no
     and NEW.entry_date = OLD.entry_date then
    return NEW;
  end if;
  raise exception 'fin: journal entry % is immutable once posted', OLD.id;
end $$;

create trigger fin_journal_entry_immutable_trg
  before update or delete on public.fin_journal_entries
  for each row execute function public.fin_journal_entry_immutable();

create or replace function public.fin_journal_line_immutable() returns trigger
language plpgsql as $$
declare parent_status fin_entry_status;
begin
  select status into parent_status from public.fin_journal_entries
    where id = coalesce(OLD.entry_id, NEW.entry_id);
  if parent_status is distinct from 'draft' then
    raise exception 'fin: lines of a posted entry are immutable';
  end if;
  return coalesce(NEW, OLD);
end $$;

create trigger fin_journal_line_immutable_trg
  before update or delete on public.fin_journal_lines
  for each row execute function public.fin_journal_line_immutable();

-- --- Double-entry invariant: a posted entry must balance (deferred safety net)
-- The posting module validates balance in-app before writing; this constraint
-- trigger is the database's own guarantee. Deferred so the app can insert the
-- entry (draft), insert its lines, then flip it to 'posted' within one txn.
create or replace function public.fin_assert_entry_balanced() returns trigger
language plpgsql as $$
declare
  imbalance numeric(20,4);
  line_count int;
begin
  if NEW.status <> 'posted' then
    return NEW;
  end if;
  select count(*), coalesce(sum(base_amount), 0)
    into line_count, imbalance
    from public.fin_journal_lines where entry_id = NEW.id;
  if line_count < 2 then
    raise exception 'fin: journal entry % must have at least two lines', NEW.id;
  end if;
  if imbalance <> 0 then
    raise exception 'fin: journal entry % is not balanced (base sum = %)', NEW.id, imbalance;
  end if;
  return NEW;
end $$;

create constraint trigger fin_entry_balanced_trg
  after insert or update on public.fin_journal_entries
  deferrable initially deferred
  for each row execute function public.fin_assert_entry_balanced();

-- --- RLS: member-read / writer-write org tenancy ----------------------------
alter table public.fin_entities enable row level security;
alter table public.fin_ledgers enable row level security;
alter table public.fin_accounts enable row level security;
alter table public.fin_periods enable row level security;
alter table public.fin_fx_rates enable row level security;
alter table public.fin_journal_entries enable row level security;
alter table public.fin_journal_lines enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'fin_entities','fin_ledgers','fin_accounts','fin_periods',
    'fin_fx_rates','fin_journal_entries','fin_journal_lines'
  ] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select using (organization_id in (select public.current_principal_org_ids()));',
      t);
    execute format(
      'create policy %1$s_write on public.%1$s for all using (public.is_org_writer(organization_id)) with check (public.is_org_writer(organization_id));',
      t);
  end loop;
end $$;

-- --- Atomic post: bump the ledger sequence, insert the entry (posted) and its
-- lines in ONE transaction. The deferred balance trigger validates the whole
-- entry at commit; RLS (security invoker) still requires the caller to be an org
-- writer. Returns the new entry id. Lines JSON: [{accountId,currency,amount,
-- baseAmount,fxRate?,memo?}, …] with signed amounts (debit +, credit −).
create or replace function public.fin_post_journal_entry(
  p_ledger uuid, p_period uuid, p_entry_date date, p_memo text,
  p_source text, p_source_ref uuid, p_reverses uuid, p_lines jsonb, p_actor uuid
) returns uuid
language plpgsql security invoker as $$
declare
  v_entity uuid; v_org uuid; v_no bigint; v_entry uuid; v_line jsonb; v_i int := 0;
begin
  select entity_id, organization_id into v_entity, v_org
    from public.fin_ledgers where id = p_ledger;
  if v_entity is null then
    raise exception 'fin: ledger % not found', p_ledger;
  end if;
  update public.fin_ledgers set entry_seq = entry_seq + 1
    where id = p_ledger returning entry_seq into v_no;

  insert into public.fin_journal_entries
    (organization_id, ledger_id, entity_id, period_id, entry_no, entry_date, memo,
     source, source_ref, reverses_entry_id, status, posted_by, posted_at, created_by)
  values (v_org, p_ledger, v_entity, p_period, v_no, p_entry_date, p_memo,
     coalesce(p_source,'manual'), p_source_ref, p_reverses, 'posted', p_actor, now(), p_actor)
  returning id into v_entry;

  for v_line in select jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    insert into public.fin_journal_lines
      (organization_id, entry_id, account_id, line_no, currency, amount, base_amount, fx_rate, memo)
    values (v_org, v_entry, (v_line->>'accountId')::uuid, v_i, v_line->>'currency',
      (v_line->>'amount')::numeric, (v_line->>'baseAmount')::numeric,
      coalesce((v_line->>'fxRate')::numeric, 1), v_line->>'memo');
  end loop;

  return v_entry;
end $$;
