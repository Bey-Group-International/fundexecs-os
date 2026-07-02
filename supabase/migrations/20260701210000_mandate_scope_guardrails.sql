-- Migration: extend mandates with the remaining spec fields.
--
-- The original mandate row stored goal + auto_approve[] + autonomy_ceiling.
-- The build spec defines a fuller shape:
--   Mandate = Goal + Scope + Guardrails + AutonomyCeiling + BlastRadiusRules
--
-- scope:             Free-text description of what this mandate covers (which
--                    hubs, which counterparty classes, which deal sizes, etc.).
-- guardrails:        Ordered list of explicit constraints Earn must respect, e.g.
--                    "Never contact a counterparty before I review the draft."
--                    Stored as a jsonb array of {rule: string} objects.
-- blast_radius_rules: Hard limits on the automated footprint per execution, e.g.
--                    max outreach per day, forbidden domains, dollar thresholds.
--                    Stored as jsonb for flexible schema evolution.
--
-- Both new jsonb columns default to empty arrays so existing rows stay valid.

ALTER TABLE mandates
  ADD COLUMN IF NOT EXISTS scope              text,
  ADD COLUMN IF NOT EXISTS guardrails         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS blast_radius_rules jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN mandates.scope              IS 'Human-readable scope of what this mandate covers — hubs, counterparty classes, deal sizes, etc.';
COMMENT ON COLUMN mandates.guardrails         IS 'Ordered list of {rule: string} constraints Earn must respect during execution.';
COMMENT ON COLUMN mandates.blast_radius_rules IS 'Hard limits on automated footprint: max outreach/day, forbidden domains, dollar thresholds, etc.';
