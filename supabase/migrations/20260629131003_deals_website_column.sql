-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS website text;
COMMENT ON COLUMN public.deals.website IS 'Company / asset website URL — used for Apollo enrichment domain lookup';;
