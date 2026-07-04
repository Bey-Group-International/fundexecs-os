-- Follow-up hardening to 20260704021000 / 20260704022000, which shipped in
-- their original form via #533's merge.
--
-- 1) The primary_strategy CHECK only allowed the four onboarding values, but
--    other writers (settings editor, seeds, imports) use the wider strategy
--    vocabulary. Re-create it as the union of every allowlist in the codebase.
-- 2) spend_org_credits logged a flat -p_amount to the ledger even when the
--    grace allowance meant the wallet only dropped to zero, breaking the
--    wallet == sum(ledger) invariant. Log the actual balance delta instead.

alter table public.organizations
  drop constraint if exists organizations_primary_strategy_check;

alter table public.organizations
  add constraint organizations_primary_strategy_check
  check (
    primary_strategy is null
    or primary_strategy in (
      'real_estate', 'private_equity', 'credit', 'multi',
      'venture_capital', 'credit_debt', 'infrastructure',
      'multi_strategy', 'fund_of_funds', 'hedge_fund', 'other'
    )
  );

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

  -- Ledger mirrors the wallet movement exactly, so wallet == sum(ledger)
  -- holds even when the grace allowance absorbs part of the charge.
  if new_balance <> current_balance then
    insert into public.credit_ledger
      (organization_id, amount, reason, note)
    values
      (p_org, new_balance - current_balance, 'spend', p_note);
  end if;

  return jsonb_build_object(
    'ok', true,
    'insufficient', false,
    'balance', new_balance
  );
end;
$$;
