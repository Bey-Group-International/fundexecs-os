-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
do $$ begin
  ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS website text;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  COMMENT ON COLUMN public.deals.website IS 'Company / asset website URL — used for Apollo enrichment domain lookup';
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table then null; end $$;;
