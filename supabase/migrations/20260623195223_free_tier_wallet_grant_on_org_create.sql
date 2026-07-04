-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
-- Migration: free_tier_wallet_grant_on_org_create
-- 1. Updates handle_new_organization() to create a wallet with 500 free-tier
--    credits for every new org at signup, and writes the audit ledger entry.
-- 2. Backfills wallet + ledger entries for the three existing orgs that have
--    no wallet yet.

CREATE OR REPLACE FUNCTION public.handle_new_organization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  -- 1. Add the creator as owner.
  insert into public.organization_members (organization_id, principal_id, role)
  values (new.id, auth.uid(), 'owner')
  on conflict (organization_id, principal_id) do nothing;

  -- 2. Create the wallet with 500 free-tier starter credits.
  insert into public.wallets (organization_id, credits, plan)
  values (new.id, 500, 'free')
  on conflict (organization_id) do nothing;

  -- 3. Write the audit ledger entry so the history page shows it.
  insert into public.credit_ledger (organization_id, amount, reason, note)
  values (new.id, 500, 'free_tier', 'Free-tier starter grant — 500 credits on signup');

  return new;
end;
$$;

-- Backfill: create wallets for orgs that slipped through before this migration.
do $$ begin
  INSERT INTO public.wallets (organization_id, credits, plan)
SELECT o.id, 500, 'free'
FROM public.organizations o
LEFT JOIN public.wallets w ON w.organization_id = o.id
WHERE w.organization_id IS NULL
ON CONFLICT (organization_id) DO NOTHING;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

-- Backfill: write ledger entries for those same orgs.
do $$ begin
  INSERT INTO public.credit_ledger (organization_id, amount, reason, note)
SELECT o.id, 500, 'free_tier', 'Free-tier starter grant — 500 credits on signup (backfilled)'
FROM public.organizations o
LEFT JOIN public.credit_ledger cl
  ON cl.organization_id = o.id AND cl.reason = 'free_tier'
WHERE cl.organization_id IS NULL;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;;
