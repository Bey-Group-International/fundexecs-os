-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
do $$ begin
  alter table public.stakeholders
  add column if not exists principal_id uuid references public.principals (id) on delete set null;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;

do $$ begin
  alter table public.stakeholders
  add column if not exists investor_id uuid references public.investors (id) on delete set null;
-- tolerated on fresh DBs where the regular sequence built a different shape
exception when undefined_column or undefined_table or undefined_object or duplicate_object then null; end $$;;
