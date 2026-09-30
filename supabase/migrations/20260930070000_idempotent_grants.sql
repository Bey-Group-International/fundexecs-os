-- 20260930070000_idempotent_grants.sql
-- Make a credit grant idempotent, so replaying a fulfillment cannot grant twice.
--
-- Checkout fulfillment has two callers (the return redirect and the Stripe
-- webhook). #1181 stopped them both granting by claiming the session first, and
-- that holds — but it leaves one state nothing can recover from: a process that
-- dies between taking the claim and recording completion. The claim stays held,
-- the completion marker never appears, and every retry correctly refuses to
-- assume the grant landed. It needs a human.
--
-- Releasing such a claim on a timer is not safe while the grant itself can run
-- twice: a stale claim may be one where the grant DID land and only the marker
-- write failed, so releasing it re-grants. And the grant cannot be made
-- idempotent from outside, because a marker written before it loses the
-- purchase on a crash and one written after it duplicates. The guard has to be
-- inside the same transaction as the effect.
--
-- So the ledger row carries the identity of what caused it. `reference` is
-- unique, the ledger insert happens FIRST with `on conflict do nothing`, and
-- the wallet moves only if that insert actually landed. Replaying a grant with
-- the same reference is then a true no-op rather than a second grant, which is
-- what makes stale-claim release safe.
--
-- Grants with no reference (referrals, coupons, free tier, spend) are untouched
-- and keep exactly the behaviour they had.

alter table public.credit_ledger
  add column if not exists reference text;

comment on column public.credit_ledger.reference is
  'Idempotency key for the event that caused this row (e.g. checkout:cs_live_…). Unique when present; null for grants with no external cause.';

-- Partial: only referenced rows are constrained, so the many unreferenced
-- historical and non-checkout rows are unaffected.
create unique index if not exists credit_ledger_reference_key
  on public.credit_ledger (reference)
  where reference is not null;

-- Drop the six-argument version FIRST, in this same transaction.
--
-- CREATE OR REPLACE cannot change a function's arity: it would add a SECOND
-- overload beside the old one, and a six-argument call — which is what every
-- currently deployed caller sends — then matches both. Postgres refuses with
-- "function grant_org_credits(...) is not unique", so every grant in the app
-- (free tier, referrals, coupons, purchases, spend) starts failing the moment
-- this is applied. Verified by doing exactly that on a scratch database.
--
-- With only the seven-argument version present, p_reference's default means a
-- six-argument call still resolves to it, so deployed code keeps working until
-- the new code ships.
drop function if exists public.grant_org_credits(uuid, integer, text, uuid, integer, text);

create or replace function public.grant_org_credits(
  p_org uuid,
  p_delta integer,
  p_reason text,
  p_source_org uuid default null,
  p_level integer default null,
  p_note text default null,
  p_reference text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_balance integer;
  ledger_id uuid;
begin
  -- Unreferenced grants keep the original order and behaviour exactly.
  if p_reference is null then
    insert into public.wallets (organization_id, credits)
      values (p_org, greatest(0, p_delta))
    on conflict (organization_id)
      do update set credits = greatest(0, wallets.credits + p_delta)
    returning credits into new_balance;

    insert into public.credit_ledger
      (organization_id, amount, reason, source_organization_id, level, note)
    values
      (p_org, p_delta, p_reason, p_source_org, p_level, p_note);

    return new_balance;
  end if;

  -- Referenced grants: the ledger insert IS the idempotency guard, so it runs
  -- before the wallet moves. Losing the conflict means this grant already
  -- happened; the wallet must not move again.
  insert into public.credit_ledger
    (organization_id, amount, reason, source_organization_id, level, note, reference)
  values
    (p_org, p_delta, p_reason, p_source_org, p_level, p_note, p_reference)
  -- The predicate is required, not decoration: ON CONFLICT does not match a
  -- PARTIAL unique index unless the conflict target repeats its WHERE clause.
  -- Without it every referenced grant raises "no unique or exclusion constraint
  -- matching the ON CONFLICT specification" — i.e. every Stripe purchase fails.
  on conflict (reference) where reference is not null do nothing
  returning id into ledger_id;

  if ledger_id is null then
    -- Already granted. Report the balance as it stands, without touching it.
    select credits into new_balance
      from public.wallets where organization_id = p_org;
    return coalesce(new_balance, 0);
  end if;

  insert into public.wallets (organization_id, credits)
    values (p_org, greatest(0, p_delta))
  on conflict (organization_id)
    do update set credits = greatest(0, wallets.credits + p_delta)
  returning credits into new_balance;

  return new_balance;
end;
$function$;
