-- 20260703110000_finance_banking_review.sql
-- Finance Phase 2 (Banking) — review follow-ups to PR #488. Delivered as a NEW
-- migration (not an edit of 20260703100000, which is already applied on the PR
-- preview branch — editing an applied migration would not re-apply).
--   M1 — constrain fin_txn_rules.match_field to an enum (was free text).
--   C1/M4 — an atomic reconcile primitive: insert the reconciliation audit row
--          AND flip the bank txn to 'reconciled' in one transaction, for a whole
--          batch of (txn, entry) pairs. autoReconcile calls it once instead of
--          2 round-trips per match; matchTransaction calls it for a single pair
--          so a link can never half-apply.

-- --- M1: match_field enum ----------------------------------------------------
do $$ begin
  create type fin_rule_match_field as enum ('description','counterparty');
exception when duplicate_object then null; end $$;

alter table public.fin_txn_rules alter column match_field drop default;
alter table public.fin_txn_rules
  alter column match_field type fin_rule_match_field using match_field::fin_rule_match_field;
alter table public.fin_txn_rules alter column match_field set default 'description';

-- --- C1/M4: atomic batch reconcile ------------------------------------------
-- p_pairs: [{ "txnId": uuid, "entryId": uuid }, …]. Returns the count applied.
-- security invoker → RLS still governs both writes; a txn outside the caller's
-- orgs resolves to null and is skipped. A unique-violation on an already-
-- reconciled txn aborts the whole call (all-or-nothing), so nothing half-applies.
create or replace function public.fin_reconcile_txns(
  p_pairs jsonb, p_match_kind fin_recon_match_kind, p_actor uuid
) returns int
language plpgsql security invoker as $$
declare
  pair jsonb; v_txn uuid; v_entry uuid; v_bank uuid; v_org uuid; n int := 0;
begin
  for pair in select jsonb_array_elements(p_pairs) loop
    v_txn := (pair->>'txnId')::uuid;
    v_entry := (pair->>'entryId')::uuid;
    select bank_account_id, organization_id into v_bank, v_org
      from public.fin_bank_transactions where id = v_txn;
    if v_bank is null then
      continue; -- not visible to this caller (RLS) / not found
    end if;
    insert into public.fin_reconciliations
      (organization_id, bank_account_id, bank_txn_id, entry_id, match_kind, matched_by)
    values (v_org, v_bank, v_txn, v_entry, p_match_kind, p_actor);
    update public.fin_bank_transactions
      set status = 'reconciled', matched_entry_id = v_entry,
          reconciled_by = p_actor, reconciled_at = now()
      where id = v_txn;
    n := n + 1;
  end loop;
  return n;
end $$;
