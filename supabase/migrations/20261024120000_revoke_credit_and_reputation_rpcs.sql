-- Close the public RPC door on the functions that move money-like balances.
--
-- grant_org_credits, increment_org_credits and increment_org_reputation are
-- SECURITY DEFINER and have no caller check inside the body: they trust their
-- arguments. They are only ever meant to be called by trusted server code
-- through the service-role client (lib/credits.ts, lib/reputation.ts).
--
-- Production nonetheless let the anonymous role execute all three. The public
-- anon key ships in the browser bundle, so anyone could call
--   POST /rest/v1/rpc/grant_org_credits  {"p_org": "<any org>", "p_delta": 1000000, ...}
-- and mint credits for any organization, or move any org's reputation score.
--
-- Why earlier revokes did not hold:
--   * 20260701000000_wallet_core_optimize revoked the SIX-argument
--     grant_org_credits. 20260930080000_idempotent_grants then dropped that
--     function and created a SEVEN-argument one, which started life with the
--     default grants again, and nothing revoked it.
--   * 0047_data_api_grants grants EXECUTE on functions to anon and
--     authenticated by default, so "revoke ... from public" alone leaves the
--     direct anon grant in place.
--   * increment_org_reputation (0048_tokenization) was never revoked.
--
-- Revoking from all three roles and granting to service_role is safe: every
-- call site in the app passes a service-role client, and none of these
-- functions is referenced by an RLS policy. REVOKE and GRANT are idempotent,
-- so this can be re-applied.

revoke execute on function public.grant_org_credits(uuid, integer, text, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_org_credits(uuid, integer, text, uuid, integer, text, text)
  to service_role;

revoke execute on function public.increment_org_credits(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.increment_org_credits(uuid, integer)
  to service_role;

revoke execute on function public.increment_org_reputation(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.increment_org_reputation(uuid, integer)
  to service_role;
