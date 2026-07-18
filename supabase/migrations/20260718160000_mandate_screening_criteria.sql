-- Migration: give the mandate a STRUCTURED screening-criteria surface.
--
-- The mandate already carries free-text `scope` + `guardrails` for the gate
-- layer. What it lacked — and what blocked mid-loop skill auto-invocation — is
-- MACHINE-READABLE screening criteria the deterministic screening/sourcing skills
-- (`screen-deal`, `source-deals`) can consume as real input without any model in
-- the loop. Free-text scope cannot be fed to a skill without parsing/fabrication;
-- this column carries the criteria as a typed object instead.
--
-- Shape (all keys optional; parsed defensively by lib/skills/screening-criteria.ts):
--   {
--     "sectors":            ["software", "healthcare"],
--     "geographies":        ["north america"],
--     "minRevenue":         10, "maxRevenue": 100,
--     "minEbitda":          2,  "maxEbitda":  30,
--     "maxEnterpriseValue": 250,
--     "transactionTypes":   ["majority", "buyout"],
--     "exclusions":         ["tobacco", "gambling"]
--   }
--
-- Additive + nullable: existing rows and every legacy mandate path are unchanged
-- (a null column means "no structured criteria" — the skills treat a silent
-- dimension as unscored, never as a fabricated constraint). No RLS change: the
-- existing mandates member-read / writer-write policies already cover the column.

ALTER TABLE mandates
  ADD COLUMN IF NOT EXISTS screening_criteria jsonb;

COMMENT ON COLUMN mandates.screening_criteria IS
  'Structured, machine-readable screening criteria (sectors, geographies, revenue/EBITDA/EV bands, transaction types, exclusions) that screen-deal / source-deals consume as real input. Null = no structured criteria; a silent dimension is never a fabricated constraint.';
