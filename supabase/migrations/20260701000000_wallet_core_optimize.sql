-- 20260701000000_wallet_core_optimize.sql
-- Wallet core optimizations:
--   1. Add plan_started_at to wallets so tenure tracks plan-start, not the last
--      credit top-up (which was resetting the loyalty clock on every grant).
--   2. Replace increment_org_credits + a separate ledger INSERT with a single
--      atomic grant_org_credits function that does both in one PL/pgSQL call,
--      preventing the race where balance changed but no ledger row was written.

-- 1. plan_started_at -------------------------------------------------------
alter table public.wallets
  add column if not exists plan_started_at timestamptz;

-- Back-fill: existing plan subscribers inherit updated_at as an approximation
-- of when their plan started (best we can do without historical data).
update public.wallets
  set plan_started_at = updated_at
  where plan is not null and plan_started_at is null;

-- 2. grant_org_credits — atomic balance + ledger ---------------------------
create or replace function public.grant_org_credits(
  p_org        uuid,
  p_delta      integer,
  p_reason     text,
  p_source_org uuid    default null,
  p_level      integer default null,
  p_note       text    default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  -- Update (or create) the wallet, clamping at zero on debits.
  insert into public.wallets (organization_id, credits)
    values (p_org, greatest(0, p_delta))
  on conflict (organization_id)
    do update set credits = greatest(0, wallets.credits + p_delta)
  returning credits into new_balance;

  -- Append the ledger row in the same transaction so balance and audit are
  -- always in sync — if either fails, both roll back.
  insert into public.credit_ledger
    (organization_id, amount, reason, source_organization_id, level, note)
  values
    (p_org, p_delta, p_reason, p_source_org, p_level, p_note);

  return new_balance;
end;
$$;

-- Grant execute only to the service role (same posture as increment_org_credits).
revoke execute on function public.grant_org_credits(uuid, integer, text, uuid, integer, text)
  from public, anon, authenticated;
