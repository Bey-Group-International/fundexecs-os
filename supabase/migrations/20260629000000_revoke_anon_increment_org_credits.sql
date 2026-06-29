-- P0-2: Close direct unauthenticated exploit of credit increment function.
-- The app-level caller (lib/credits.ts) uses the service-role client and is unaffected.
REVOKE EXECUTE ON FUNCTION public.increment_org_credits(uuid, integer) FROM anon;
