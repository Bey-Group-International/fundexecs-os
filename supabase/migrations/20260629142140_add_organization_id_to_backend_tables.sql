-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
ALTER TABLE public.pr_reviews ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.webhook_logs ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);;
