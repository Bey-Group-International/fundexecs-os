-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
alter type inbox_channel add value if not exists 'deal_share';
alter type inbox_channel add value if not exists 'ecosystem';;
