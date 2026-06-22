-- 0061_artifact_provenance.sql
-- The trust layer, phase 1: make every composer-produced artifact real and
-- verifiable. Artifacts gain the same provenance/verification columns the rest
-- of the record modules already carry (migration 0034), plus two grounding
-- fields unique to AI output:
--   • provenance          — how it was produced (ai / manual / import)
--   • verification_status — unverified | verified
--   • verified_at / by    — who signed it off and when (the human gate; phase 2)
--   • verification_note    — the evidence/grounding behind a verification
--   • sources             — the passages the executing Brain consulted, as
--                           [{ source, snippet, score, kind }] — the citations
--   • brain_run_id        — link to the brain_runs row that produced the output,
--                           so its reasoning + retrieval is discoverable
--
-- No new RLS needed: the existing artifacts_write policy is FOR ALL, so org
-- writers can already UPDATE (verify) these rows.

alter table public.artifacts
  add column if not exists provenance text not null default 'ai',
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.principals (id) on delete set null,
  add column if not exists verification_note text,
  add column if not exists sources jsonb not null default '[]'::jsonb,
  add column if not exists brain_run_id uuid references public.brain_runs (id) on delete set null;

-- Find unverified artifacts for an org quickly (the "needs review" surfaces).
create index if not exists artifacts_verification_idx
  on public.artifacts (organization_id, verification_status);
