-- Atomic AI credit debit.
-- Prevents parallel agent executions from passing a stale balance check before
-- debiting the same wallet.

create or replace function public.spend_org_credits(
  p_org    uuid,
  p_amount integer,
  p_grace  integer default 0,
  p_note   text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance integer;
  new_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'p_amount must be positive';
  end if;

  insert into public.wallets (organization_id, credits)
    values (p_org, 0)
  on conflict (organization_id) do nothing;

  select credits
    into current_balance
    from public.wallets
   where organization_id = p_org
   for update;

  if current_balance + p_grace < p_amount then
    return jsonb_build_object(
      'ok', false,
      'insufficient', true,
      'balance', current_balance
    );
  end if;

  new_balance := greatest(0, current_balance - p_amount);

  update public.wallets
     set credits = new_balance
   where organization_id = p_org;

  insert into public.credit_ledger
    (organization_id, amount, reason, note)
  values
    (p_org, -p_amount, 'spend', p_note);

  return jsonb_build_object(
    'ok', true,
    'insufficient', false,
    'balance', new_balance
  );
end;
$$;

revoke execute on function public.spend_org_credits(uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.spend_org_credits(uuid, integer, integer, text)
  to service_role;
