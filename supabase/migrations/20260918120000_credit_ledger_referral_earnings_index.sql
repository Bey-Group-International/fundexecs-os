-- The Invite page's "referral credits earned" figure is a sum over the ledger
-- filtered by organization AND reason. Until now it was computed by reading
-- every ledger row for the org into the app and adding up the four referral
-- kinds there — so the work grew with an org's total product usage (plan
-- grants, pack purchases, and one row per agent step), not with how many
-- referrals it had made.
--
-- The sum now runs in the database. The existing indexes cover
-- organization_id alone, which still means scanning every row an org owns to
-- discard the non-referral ones. This composite covers both filter columns,
-- and carries `amount` as an INCLUDE payload so the sum is answered from the
-- index without touching the heap.
create index if not exists credit_ledger_org_reason_idx
  on public.credit_ledger (organization_id, reason) include (amount);
