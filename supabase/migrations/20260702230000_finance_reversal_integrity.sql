-- 20260702230000_finance_reversal_integrity.sql
-- Finance Phase 1 hardening — closes correctness gaps found in review of the
-- initial ledger migration (20260702220000):
--   1. Line-immutability trigger didn't fire on INSERT → a writer could add
--      phantom lines to a POSTED entry and unbalance it. Now guarded on INSERT.
--   2. The posting RPC inserted the entry directly as 'posted', which (with #1's
--      fix) would block its own line inserts. It now inserts the entry as 'draft',
--      adds lines, then flips to 'posted' — so the deferred balance constraint
--      and the INSERT guard both hold, and posting an unbalanced entry is
--      impossible at every layer.
--   3. TOCTOU: the app read period status, then called the RPC separately, so a
--      period closing in between could let a post slip in Tier-1. The RPC now
--      locks and re-checks the period is 'open' inside its own transaction.
--   4. Reversal: atomic + unrepeatable (row lock + status flip in the RPC,
--      backed by a partial-unique index on reverses_entry_id).
--   5. Overlapping accounting periods are rejected.
--   6. A CHECK constrains journal-entry `source` to the documented set.

-- 1. Line immutability must also cover INSERT (the coalesce handles NEW/OLD).
drop trigger if exists fin_journal_line_immutable_trg on public.fin_journal_lines;
create trigger fin_journal_line_immutable_trg
  before insert or update or delete on public.fin_journal_lines
  for each row execute function public.fin_journal_line_immutable();

-- 4. At most one reversal entry per original.
create unique index if not exists fin_journal_entries_reverses_uniq
  on public.fin_journal_entries (reverses_entry_id)
  where reverses_entry_id is not null;

-- 6. Constrain `source` to the documented set (idempotent add).
do $$ begin
  alter table public.fin_journal_entries
    add constraint fin_journal_entries_source_check
    check (source in ('manual','invoice','payment','bank','fx','system','reversal'));
exception when duplicate_object then null; end $$;

-- 2 + 3 + 4. Rebuilt posting RPC: draft-first insert, period-open guard, and
-- atomic reversal — all inside one transaction.
create or replace function public.fin_post_journal_entry(
  p_ledger uuid, p_period uuid, p_entry_date date, p_memo text,
  p_source text, p_source_ref uuid, p_reverses uuid, p_lines jsonb, p_actor uuid
) returns uuid
language plpgsql security invoker as $$
declare
  v_entity uuid; v_org uuid; v_no bigint; v_entry uuid; v_line jsonb; v_i int := 0;
  v_period_status fin_period_status; v_orig_status fin_entry_status;
begin
  select entity_id, organization_id into v_entity, v_org
    from public.fin_ledgers where id = p_ledger;
  if v_entity is null then
    raise exception 'fin: ledger % not found', p_ledger;
  end if;

  -- TOCTOU guard: lock the period and confirm it is still open at post time.
  -- (A future approved closed-period post will take a distinct, gated path.)
  select status into v_period_status
    from public.fin_periods where id = p_period for update;
  if v_period_status is null then
    raise exception 'fin: period % not found', p_period;
  elsif v_period_status <> 'open' then
    raise exception 'fin: period % is % — posting requires an open period', p_period, v_period_status;
  end if;

  -- Reversal guard: lock the original and confirm it is still posted; two
  -- concurrent reversals serialize here and the second aborts.
  if p_reverses is not null then
    select status into v_orig_status
      from public.fin_journal_entries where id = p_reverses for update;
    if v_orig_status is null then
      raise exception 'fin: original entry % not found', p_reverses;
    elsif v_orig_status <> 'posted' then
      raise exception 'fin: entry % is not posted (already reversed?)', p_reverses;
    end if;
  end if;

  update public.fin_ledgers set entry_seq = entry_seq + 1
    where id = p_ledger returning entry_seq into v_no;

  -- Insert as DRAFT so line inserts are permitted, then post.
  insert into public.fin_journal_entries
    (organization_id, ledger_id, entity_id, period_id, entry_no, entry_date, memo,
     source, source_ref, reverses_entry_id, status, created_by)
  values (v_org, p_ledger, v_entity, p_period, v_no, p_entry_date, p_memo,
     coalesce(p_source,'manual'), p_source_ref, p_reverses, 'draft', p_actor)
  returning id into v_entry;

  for v_line in select jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    insert into public.fin_journal_lines
      (organization_id, entry_id, account_id, line_no, currency, amount, base_amount, fx_rate, memo)
    values (v_org, v_entry, (v_line->>'accountId')::uuid, v_i, v_line->>'currency',
      (v_line->>'amount')::numeric, (v_line->>'baseAmount')::numeric,
      coalesce((v_line->>'fxRate')::numeric, 1), v_line->>'memo');
  end loop;

  -- Flip to posted: fires the deferred balance constraint (validated at commit,
  -- with all lines present) and locks the entry against further change.
  update public.fin_journal_entries
    set status = 'posted', posted_by = p_actor, posted_at = now()
    where id = v_entry;

  -- Atomic with the reversal post: flip the original to 'reversed'.
  if p_reverses is not null then
    update public.fin_journal_entries set status = 'reversed' where id = p_reverses;
  end if;

  return v_entry;
end $$;

-- 5. Reject overlapping accounting periods for an entity (built-in daterange/&&).
create or replace function public.fin_periods_no_overlap() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from public.fin_periods p
    where p.entity_id = NEW.entity_id
      and p.id <> NEW.id
      and daterange(p.starts_on, p.ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')
  ) then
    raise exception 'fin: period %..% overlaps an existing period for this entity',
      NEW.starts_on, NEW.ends_on;
  end if;
  return NEW;
end $$;

drop trigger if exists fin_periods_no_overlap_trg on public.fin_periods;
create trigger fin_periods_no_overlap_trg
  before insert or update on public.fin_periods
  for each row execute function public.fin_periods_no_overlap();
