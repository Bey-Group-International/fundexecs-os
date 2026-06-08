-- ============================================================================
-- claim_invoice_and_grant — atomically claim a subscription invoice and grant
-- its credits in a single transaction.
--
-- The webhook previously inserted the idempotency row, then called
-- grant_credits separately: if the grant failed after the insert committed,
-- Stripe's retry would see the claimed invoice and skip the grant forever (the
-- customer pays but never receives credits). Doing both inside one function
-- (one transaction) means a failed grant rolls back the claim, so the retry
-- re-attempts cleanly. Returns the new balance, or NULL if already claimed.
-- ============================================================================

create or replace function public.claim_invoice_and_grant(
  _stripe_invoice_id text,
  _org_id uuid,
  _amount integer,
  _period_end timestamptz default null,
  _reason text default 'subscription_credit'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _inserted integer;
begin
  if _amount is null or _amount <= 0 then
    return null;
  end if;

  insert into public.subscription_invoices (stripe_invoice_id, org_id, credits_granted, period_end)
  values (_stripe_invoice_id, _org_id, _amount, _period_end)
  on conflict (stripe_invoice_id) do nothing;

  get diagnostics _inserted = row_count;
  if _inserted = 0 then
    -- Already claimed by a prior (successful) delivery — nothing to do.
    return null;
  end if;

  -- Same transaction: a failure here rolls back the claim above.
  return public.grant_credits(_org_id, _amount, _reason, null);
end;
$$;

revoke all on function public.claim_invoice_and_grant(text, uuid, integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.claim_invoice_and_grant(text, uuid, integer, timestamptz, text)
  to service_role;
