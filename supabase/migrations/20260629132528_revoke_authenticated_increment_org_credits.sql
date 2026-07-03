-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
REVOKE EXECUTE ON FUNCTION public.increment_org_credits(uuid, integer) FROM authenticated;;
