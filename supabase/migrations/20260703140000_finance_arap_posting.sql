-- 20260703140000_finance_arap_posting.sql
-- Finance Phase 3/4 — GL-posting increment (follow-up to #489).
--   1. fin_apply_payment: close the auto-allocation TOCTOU. When p_allocations is
--      empty the RPC now selects the party's open invoices FOR UPDATE and
--      allocates oldest-due-first INSIDE the transaction, so a concurrent payment
--      to the same party cannot drive an invoice's amount_paid past its total.
--      Explicit allocations still take the caller-supplied path.
--   2. fin_cleanup_draft_invoices: sweep stale 'draft' invoices (a crash between
--      the line insert and the draft→open flip leaves an invisible draft). Meant
--      for a scheduled job; safe to call anytime.

create or replace function public.fin_apply_payment(
  p_payment jsonb, p_allocations jsonb, p_actor uuid
) returns uuid
language plpgsql security invoker as $$
declare
  v_org uuid; v_payment uuid; alloc jsonb; v_inv uuid; v_amt numeric(20,2);
  v_kind fin_invoice_kind; v_remaining numeric(20,2); v_take numeric(20,2); rec record;
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

  if jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) > 0 then
    -- Caller-supplied allocations.
    for alloc in select jsonb_array_elements(p_allocations) loop
      v_inv := (alloc->>'invoiceId')::uuid;
      v_amt := (alloc->>'amount')::numeric;
      insert into public.fin_payment_allocations (organization_id, payment_id, invoice_id, amount)
      values (v_org, v_payment, v_inv, v_amt);
      update public.fin_invoices
        set amount_paid = amount_paid + v_amt,
            status = case
              when status = 'void' then status
              when (amount_paid + v_amt) >= total and total > 0 then 'paid'::fin_invoice_status
              when (amount_paid + v_amt) > 0 then 'partial'::fin_invoice_status
              else 'open'::fin_invoice_status end
        where id = v_inv;
    end loop;
  else
    -- Auto-allocate oldest-due-first, holding row locks through the whole loop so
    -- a concurrent payment to the same party serializes behind us.
    v_kind := case when (p_payment->>'direction') = 'inbound'
                   then 'receivable' else 'payable' end::fin_invoice_kind;
    v_remaining := (p_payment->>'amount')::numeric;
    for rec in
      select id, total, amount_paid
        from public.fin_invoices
        where organization_id = v_org
          and entity_id = (p_payment->>'entityId')::uuid
          and party_id = (p_payment->>'partyId')::uuid
          and kind = v_kind
          and status in ('open','partial')
        order by due_date nulls last, id
        for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, rec.total - rec.amount_paid);
      if v_take <= 0 then continue; end if;
      insert into public.fin_payment_allocations (organization_id, payment_id, invoice_id, amount)
      values (v_org, v_payment, rec.id, v_take);
      update public.fin_invoices
        set amount_paid = amount_paid + v_take,
            status = case
              when (amount_paid + v_take) >= total and total > 0 then 'paid'::fin_invoice_status
              when (amount_paid + v_take) > 0 then 'partial'::fin_invoice_status
              else 'open'::fin_invoice_status end
        where id = rec.id;
      v_remaining := v_remaining - v_take;
    end loop;
  end if;

  return v_payment;
end $$;

-- Sweep drafts older than the cutoff (default 1 hour). Returns the count removed.
create or replace function public.fin_cleanup_draft_invoices(p_older_than interval default interval '1 hour')
returns integer
language plpgsql security invoker as $$
declare v_deleted integer;
begin
  with removed as (
    delete from public.fin_invoices
      where status = 'draft' and created_at < now() - p_older_than
      returning 1
  )
  select count(*) into v_deleted from removed;
  return v_deleted;
end $$;
