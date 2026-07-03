-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
alter table public.diligence_items
  add column if not exists owner    text,
  add column if not exists due_date date;;
