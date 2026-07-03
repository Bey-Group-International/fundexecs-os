-- Backfilled from the production migration history (applied directly to prod
-- via MCP/dashboard before the DB Migrate workflow existed). Present in the
-- repo so `supabase db push` sees local >= remote; already applied in prod.
ALTER TABLE mandates
  ADD COLUMN IF NOT EXISTS scope              text,
  ADD COLUMN IF NOT EXISTS guardrails         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS blast_radius_rules jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN mandates.scope              IS 'Human-readable scope of what this mandate covers — hubs, counterparty classes, deal sizes, etc.';
COMMENT ON COLUMN mandates.guardrails         IS 'Ordered list of {rule: string} constraints Earn must respect during execution.';
COMMENT ON COLUMN mandates.blast_radius_rules IS 'Hard limits on automated footprint: max outreach/day, forbidden domains, dollar thresholds, etc.';;
