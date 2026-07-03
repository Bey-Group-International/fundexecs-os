-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.match_brain_kb_chunks(query_embedding extensions.vector(256), target_brain_key text, match_count int) SET search_path = public, extensions;;
