-- 20260703130000_finance_arap_payment_atomic.sql
-- Finance Phase 3 (AR/AP) — review follow-up to PR #489. Delivered as a NEW
-- migration (not an edit of 20260703120000, already applied on the PR preview)
-- so the preview re-validates the new RPC body.
--
-- fin_apply_payment previously bumped fin_invoices.amount_paid and set `status`
-- in TWO statements, deriving status from a PL/pgSQL variable captured by the
-- first UPDATE's RETURNING. Across a multi-invoice loop the per-row lock is
-- released between the two statements, so a concurrent payment to the same
-- invoice could commit in between and leave a fully-paid invoice stuck in
-- 'partial'. Merge both writes into ONE statement so amount_paid and the status
-- derived from it are computed and committed under a single row lock.
create or replace function public.fin_apply_payment(
  p_payment jsonb, p_allocations jsonb, p_actor uuid
) returns uuid
language plpgsql security invoker as $$
declare
  v_org uuid; v_payment uuid; alloc jsonb; v_inv uuid; v_amt numeric(20,2);
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
    -- Single atomic write: bump amount_paid AND derive status from the new value,
    -- both under one row lock (no stale-read window for a concurrent payment).
    update public.fin_invoices
      set amount_paid = amount_paid + v_amt,
          status = case
            when status = 'void' then status
            when (amount_paid + v_amt) >= total and total > 0 then 'paid'::fin_invoice_status
            when (amount_paid + v_amt) > 0 then 'partial'::fin_invoice_status
            else 'open'::fin_invoice_status end
      where id = v_inv;
  end loop;

  return v_payment;
end $$;
