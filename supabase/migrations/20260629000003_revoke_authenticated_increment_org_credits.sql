-- Authenticated users could POST to /rest/v1/rpc/increment_org_credits with any
-- org UUID, adding credits to orgs they don't own. The app calls this exclusively
-- via service-role (lib/credits.ts), so revoking from authenticated is safe.
REVOKE EXECUTE ON FUNCTION public.increment_org_credits(uuid, integer) FROM authenticated;
