-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
do $$ begin
  ALTER TABLE public.pr_reviews ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;
do $$ begin
  ALTER TABLE public.webhook_logs ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;;
