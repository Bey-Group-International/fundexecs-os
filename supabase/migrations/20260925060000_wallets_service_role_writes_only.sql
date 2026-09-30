-- Wallets are entitlements: `plan` unlocks paid features (lib/feature-access)
-- and `credits` is spendable balance. The 0018 wallets_write policy let any org
-- writer (owner/admin/member) update their own wallet row from the browser —
-- including setting plan = 'pro' or topping up credits for free.
--
-- Every legitimate wallet write already goes through the service role
-- (subscriptions, Stripe webhook, trial grant, payment routes) or a SECURITY
-- DEFINER function (handle_new_organization, grant/spend_org_credits), none of
-- which RLS applies to. Members keep read access via wallets_select.
drop policy if exists wallets_write on public.wallets;
