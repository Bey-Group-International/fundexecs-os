-- 20260703000000_finance_hardening_followups.sql
-- Finance Phase 1 hardening — follow-ups to review of PR #485. Delivered as a
-- NEW migration (not an edit/rename of 20260702240000) because that file is
-- already applied on the preview branch; renaming an applied migration breaks
-- the branch's migration history ("remote migration versions not found").
--   m1 — the closed-period TOCTOU RAISE now carries a stable SQLSTATE ('FIN01')
--        so the app branches on error.code, not fragile message text.
--   m3 — the entity/account parent guards reject multi-hop cycles
--        (A → B → C → A) via a recursive ancestor walk, not only self-parenting.

-- --- m1: rebuild the posting RPC. Identical to 20260702230000 except the
-- closed-period RAISE now carries ERRCODE 'FIN01'. CREATE OR REPLACE — the
-- latest definition wins.
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
  -- The closed-period case carries a stable SQLSTATE ('FIN01') so the app layer
  -- can route it to the Tier-3 approval path by error.code, not message text.
  select status into v_period_status
    from public.fin_periods where id = p_period for update;
  if v_period_status is null then
    raise exception 'fin: period % not found', p_period;
  elsif v_period_status <> 'open' then
    raise exception 'fin: period % is % — posting requires an open period', p_period, v_period_status
      using errcode = 'FIN01';
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

-- --- m3: entity parent guard, now with a multi-hop cycle check. Redefines the
-- function 20260702240000 created; the existing trigger already binds to it by
-- name, so it picks up this definition (trigger re-created too, idempotently).
create or replace function public.fin_entity_parent_same_org() returns trigger
language plpgsql as $$
begin
  if NEW.parent_entity_id is not null then
    if NEW.parent_entity_id = NEW.id then
      raise exception 'fin: an entity cannot be its own parent';
    end if;
    if not exists (
      select 1 from public.fin_entities
      where id = NEW.parent_entity_id
        and organization_id = NEW.organization_id
    ) then
      raise exception 'fin: parent entity must belong to the same organization';
    end if;
    -- Cycle guard: walking ancestors up from the proposed parent must never
    -- reach NEW.id. Existing rows are acyclic (this trigger keeps them so), so
    -- the recursive walk always terminates.
    if exists (
      with recursive ancestors as (
        select id, parent_entity_id
          from public.fin_entities where id = NEW.parent_entity_id
        union all
        select e.id, e.parent_entity_id
          from public.fin_entities e
          join ancestors a on e.id = a.parent_entity_id
      )
      select 1 from ancestors where id = NEW.id
    ) then
      raise exception 'fin: circular entity hierarchy detected';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists fin_entity_parent_same_org_trg on public.fin_entities;
create trigger fin_entity_parent_same_org_trg
  before insert or update on public.fin_entities
  for each row execute function public.fin_entity_parent_same_org();

-- --- m3: account parent guard, same-org AND same-entity, now cycle-checked.
create or replace function public.fin_account_parent_same_org() returns trigger
language plpgsql as $$
begin
  if NEW.parent_account_id is not null then
    if NEW.parent_account_id = NEW.id then
      raise exception 'fin: an account cannot be its own parent';
    end if;
    -- A parent account must be in the same org AND the same entity as the child.
    if not exists (
      select 1 from public.fin_accounts
      where id = NEW.parent_account_id
        and organization_id = NEW.organization_id
        and entity_id = NEW.entity_id
    ) then
      raise exception 'fin: parent account must belong to the same organization and entity';
    end if;
    -- Cycle guard (see fin_entity_parent_same_org for rationale).
    if exists (
      with recursive ancestors as (
        select id, parent_account_id
          from public.fin_accounts where id = NEW.parent_account_id
        union all
        select a.id, a.parent_account_id
          from public.fin_accounts a
          join ancestors anc on a.id = anc.parent_account_id
      )
      select 1 from ancestors where id = NEW.id
    ) then
      raise exception 'fin: circular account hierarchy detected';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists fin_account_parent_same_org_trg on public.fin_accounts;
create trigger fin_account_parent_same_org_trg
  before insert or update on public.fin_accounts
  for each row execute function public.fin_account_parent_same_org();
