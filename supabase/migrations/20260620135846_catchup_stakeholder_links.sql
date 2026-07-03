-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
alter table public.stakeholders
  add column if not exists principal_id uuid references public.principals (id) on delete set null;

alter table public.stakeholders
  add column if not exists investor_id uuid references public.investors (id) on delete set null;;
