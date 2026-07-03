-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
alter table public.organizations
  add column if not exists discoverable boolean not null default true;

comment on column public.organizations.discoverable is
  'When true, this org participates in instant ecosystem matchmaking: its firm profile may be surfaced to matching orgs and it receives match alerts. Opt out from Settings to go dark.';;
