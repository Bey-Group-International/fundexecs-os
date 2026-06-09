-- =====================================================================
-- Credit metering: idempotent monthly free grant per plan.
--
-- Additive + idempotent. Builds on the credit ledger from
-- 20260606200000_wave2_data_models.sql (credit_wallets, credit_transactions,
-- consume_credits, grant_credits). Adds `claim_monthly_credit_grant`, which
-- tops an org up by its plan's monthly allowance at most once per calendar
-- month. Safe to call on any authenticated request (members of the org) or
-- from the cron (service_role); it no-ops if this month is already granted.
--
-- Plan amounts mirror MONTHLY_GRANT in lib/credits/costs.ts — keep in sync.
-- =====================================================================

create or replace function public.claim_monthly_credit_grant(_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _plan text;
  _amount integer;
  _month_key text := to_char(now() at time zone 'utc', 'YYYY-MM');
  _reason text;
  _existing integer;
  _balance integer;
begin
  if _org_id is null then
    raise exception 'org_id is required' using errcode = '22023';
  end if;

  -- Authorize: the cron (service_role) or an active member of the org.
  if coalesce((select auth.role()), '') <> 'service_role'
     and not exists (
       select 1 from public.org_members om
       where om.org_id = _org_id
         and om.user_id = auth.uid()
         and om.status = 'active'
     )
  then
    raise exception 'not a member of org %', _org_id using errcode = '42501';
  end if;

  _reason := 'monthly_grant:' || _month_key;

  -- Serialize concurrent claims for the same org+month so a double-submit
  -- can't grant twice.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('monthly_grant:' || _org_id::text || ':' || _month_key, 0)
  );

  -- Already granted this month → return the current balance unchanged.
  select count(*) into _existing
  from public.credit_transactions
  where org_id = _org_id and reason = _reason;

  if _existing > 0 then
    select balance into _balance from public.credit_wallets where org_id = _org_id;
    return coalesce(_balance, 0);
  end if;

  -- Resolve the plan (default to the thin free tier when no wallet exists yet).
  select plan into _plan from public.credit_wallets where org_id = _org_id;
  _plan := coalesce(_plan, 'free');

  _amount := case _plan
    when 'institutional' then 15000
    when 'pro' then 2500
    when 'standard' then 500
    else 50  -- free
  end;

  -- grant_credits upserts the wallet, adds the balance, and writes the audit
  -- row with our month-scoped reason (which gates the next claim).
  select public.grant_credits(_org_id, _amount, _reason) into _balance;
  return _balance;
end;
$$;

revoke all on function public.claim_monthly_credit_grant(uuid) from public, anon;
grant execute on function public.claim_monthly_credit_grant(uuid) to authenticated, service_role;
