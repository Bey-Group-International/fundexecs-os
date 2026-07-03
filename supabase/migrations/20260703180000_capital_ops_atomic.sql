-- 20260703180000_capital_ops_atomic.sql
-- Capital calls, distributions, and LP secondary transfers used to be written
-- from the application as a loop of independent, unchecked Supabase calls: one
-- INSERT per capital_events row, a JS-computed `(current ?? 0) + delta`
-- read-then-write on each commitment, and a final read-then-write on the
-- fund's aggregate — with no transaction and no error checked at any step. A
-- mid-loop failure (RLS rejection, network blip) silently half-books a run:
-- some LPs get a capital_events row and an updated commitment, others don't,
-- and the fund aggregate is still rolled by the FULL planned total regardless.
-- Two concurrent runs on the same fund also lose updates outright (the JS
-- read-then-write has no lock spanning the read and the write).
--
-- These RPCs mirror the fin_apply_payment pattern (20260703130000): the whole
-- write set for one run/transfer happens in ONE transaction, so a failure
-- anywhere rolls back everything instead of leaving a partial ledger, and each
-- commitment/fund mutation is an atomic `col = col + delta` UPDATE (the
-- statement itself holds the row lock for its own read-modify-write — no
-- separate SELECT needed) rather than a JS-computed read-then-write.
--
-- capital_run_apply also closes a residual TOCTOU: the pro-rata allocation
-- plan is still computed in application code from a pre-transaction read (the
-- allocation math itself — lib/capital-ops.ts — stays pure, tested TypeScript
-- rather than being duplicated in PL/pgSQL). If a concurrent call raced ahead
-- and the plan's numbers are now stale by the time this function actually
-- holds the lock, the guarded UPDATE below affects zero rows and the function
-- raises — rolling back the whole run — instead of silently over-calling an
-- LP past their commitment.

create or replace function public.capital_run_apply(
  p_org uuid,
  p_fund_id uuid,
  p_kind text,          -- 'capital_call' | 'distribution'
  p_allocations jsonb,   -- [{ commitmentId, investorId, allocation }, ...]
  p_reference text,
  p_effective_date date
) returns jsonb
language plpgsql security invoker as $$
declare
  alloc jsonb;
  v_commitment uuid;
  v_investor uuid;
  v_amount numeric(18,2);
  v_total numeric(18,2) := 0;
  v_updated uuid;
begin
  if p_kind not in ('capital_call', 'distribution') then
    raise exception 'invalid capital run kind: %', p_kind;
  end if;

  for alloc in select * from jsonb_array_elements(p_allocations) loop
    v_commitment := (alloc->>'commitmentId')::uuid;
    v_investor := (alloc->>'investorId')::uuid;
    v_amount := (alloc->>'allocation')::numeric;
    if v_amount is null or v_amount <= 0 then continue; end if;

    insert into public.capital_events
      (organization_id, fund_id, investor_id, event_type, amount, currency, effective_date, reference)
    values
      (p_org, p_fund_id, v_investor, p_kind::capital_event_type, v_amount, 'USD', p_effective_date, p_reference);

    if p_kind = 'capital_call' then
      -- Guarded atomic increment: the row lock, the read of the current
      -- balance, and the write all happen inside this single UPDATE, and the
      -- WHERE clause re-validates the unfunded cap against whatever
      -- committed_amount actually is right now — not the pre-transaction
      -- snapshot the allocation plan was computed from.
      update public.commitments
        set called_amount = called_amount + v_amount
        where id = v_commitment
          and organization_id = p_org
          and called_amount + v_amount <= committed_amount + 0.01
        returning id into v_updated;
      if v_updated is null then
        raise exception 'capital call of % would exceed commitment for commitment %', v_amount, v_commitment;
      end if;
    else
      update public.commitments
        set distributed_amount = distributed_amount + v_amount
        where id = v_commitment
          and organization_id = p_org
        returning id into v_updated;
      if v_updated is null then
        raise exception 'commitment % not found for distribution', v_commitment;
      end if;
    end if;

    v_total := v_total + v_amount;
  end loop;

  if v_total <= 0 then
    raise exception 'no allocations were applied';
  end if;

  if p_kind = 'capital_call' then
    update public.funds set called_capital = called_capital + v_total
      where id = p_fund_id and organization_id = p_org;
  else
    update public.funds set distributed_capital = distributed_capital + v_total
      where id = p_fund_id and organization_id = p_org;
  end if;

  return jsonb_build_object('totalApplied', v_total);
end $$;

-- LP secondary transfer: move a fraction of a seller's commitment (committed /
-- called / distributed) to a buyer's commitment in the same fund, creating the
-- buyer's row if this is their first position in that fund. The seller's row
-- is locked with SELECT ... FOR UPDATE before any write (so two concurrent
-- transfers of the same seller position serialize instead of racing), and the
-- buyer's side is an atomic upsert keyed on the table's own (fund_id,
-- investor_id) uniqueness (so two concurrent transfers to the same brand-new
-- buyer can't both insert a duplicate row).
create or replace function public.capital_secondary_transfer(
  p_org uuid,
  p_seller_commitment_id uuid,
  p_buyer_investor_id uuid,
  p_fraction numeric
) returns jsonb
language plpgsql security invoker as $$
declare
  v_fund uuid;
  v_seller_investor uuid;
  v_committed numeric(18,2);
  v_called numeric(18,2);
  v_distributed numeric(18,2);
  x_committed numeric(18,2);
  x_called numeric(18,2);
  x_distributed numeric(18,2);
begin
  if p_fraction is null or p_fraction <= 0 or p_fraction > 1 then
    raise exception 'invalid transfer fraction: %', p_fraction;
  end if;

  select fund_id, investor_id, committed_amount, called_amount, distributed_amount
    into v_fund, v_seller_investor, v_committed, v_called, v_distributed
    from public.commitments
    where id = p_seller_commitment_id and organization_id = p_org
    for update;

  if not found then
    raise exception 'seller commitment % not found', p_seller_commitment_id;
  end if;
  if v_seller_investor = p_buyer_investor_id then
    raise exception 'buyer and seller must be different investors';
  end if;

  x_committed := round(v_committed * p_fraction, 2);
  x_called := round(v_called * p_fraction, 2);
  x_distributed := round(v_distributed * p_fraction, 2);
  if x_committed <= 0 then
    raise exception 'transfer amount rounds to zero';
  end if;

  update public.commitments
    set committed_amount = committed_amount - x_committed,
        called_amount = called_amount - x_called,
        distributed_amount = distributed_amount - x_distributed
    where id = p_seller_commitment_id and organization_id = p_org;

  -- Upsert onto the buyer's position: the ON CONFLICT target is the table's
  -- own (fund_id, investor_id) unique constraint, so the insert-or-increment
  -- is one atomic statement — two concurrent transfers to the same brand-new
  -- buyer can't both observe "no row yet" and race to insert a duplicate the
  -- way a separate SELECT-then-branch would.
  insert into public.commitments
    (organization_id, fund_id, investor_id, committed_amount, called_amount, distributed_amount)
  values
    (p_org, v_fund, p_buyer_investor_id, x_committed, x_called, x_distributed)
  on conflict (fund_id, investor_id) do update
    set committed_amount = public.commitments.committed_amount + excluded.committed_amount,
        called_amount = public.commitments.called_amount + excluded.called_amount,
        distributed_amount = public.commitments.distributed_amount + excluded.distributed_amount;

  return jsonb_build_object(
    'fundId', v_fund,
    'committed', x_committed,
    'called', x_called,
    'distributed', x_distributed
  );
end $$;
