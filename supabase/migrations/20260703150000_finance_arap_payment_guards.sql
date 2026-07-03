-- 20260703150000_finance_arap_payment_guards.sql
-- Finance AR/AP — review follow-up to PR #490. New migration (the RPC in
-- 20260703140000 is already applied on the PR preview, so an in-place edit would
-- not re-validate).
--   #3 hard guard: an invoice can never be over-paid — CHECK (amount_paid <=
--      total) rejects it at the DB on either allocation path. Existing rows all
--      satisfy this, so the ADD CONSTRAINT validates cleanly.
--   #2 tenancy: the caller-supplied allocation path now scopes the invoice
--      update to the payment's own org / entity / party (RLS already blocks
--      cross-org; this also blocks cross-party/entity within an org) and aborts
--      on a mismatch instead of silently touching the wrong invoice.

do $$ begin
  alter table public.fin_invoices
    add constraint fin_invoices_amount_paid_le_total check (amount_paid <= total);
exception when duplicate_object then null; end $$;

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
    -- Caller-supplied allocations. Update the invoice FIRST, scoped to this
    -- payment's org/entity/party (abort on mismatch), THEN record the allocation.
    -- The CHECK constraint rejects any over-payment.
    for alloc in select jsonb_array_elements(p_allocations) loop
      v_inv := (alloc->>'invoiceId')::uuid;
      v_amt := (alloc->>'amount')::numeric;
      update public.fin_invoices
        set amount_paid = amount_paid + v_amt,
            status = case
              when status = 'void' then status
              when (amount_paid + v_amt) >= total and total > 0 then 'paid'::fin_invoice_status
              when (amount_paid + v_amt) > 0 then 'partial'::fin_invoice_status
              else 'open'::fin_invoice_status end
        where id = v_inv
          and organization_id = v_org
          and entity_id = (p_payment->>'entityId')::uuid
          and party_id = (p_payment->>'partyId')::uuid
          and status <> 'void';
      if not found then
        raise exception 'fin: allocation invoice % is not an open invoice for this payment''s party/entity', v_inv;
      end if;
      insert into public.fin_payment_allocations (organization_id, payment_id, invoice_id, amount)
      values (v_org, v_payment, v_inv, v_amt);
    end loop;
  else
    -- Auto-allocate oldest-due-first, holding row locks through the whole loop.
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
