-- 20260708180000_artifact_critic.sql
-- Trust layer, phase 3: the automated CRITIC. Alongside the grounding score
-- (migration 0066, "does the output use its evidence?"), every AI artifact now
-- carries an automated critic read of whether the deliverable is actually a
-- usable answer — not a refusal, placeholder stub, or off-topic drift
-- (lib/engine-critic). Computed deterministically at execution time and shown at
-- the human approval gate so reviewers lead with any red flags; the operator's
-- sign-off remains authoritative on top of it.
--
-- Nullable / defaulted so existing artifacts (produced before this layer) simply
-- carry no critic read rather than needing a backfill.

alter table public.artifacts
  add column if not exists critic_verdict text
    check (critic_verdict is null or critic_verdict in ('pass', 'revise', 'fail')),
  add column if not exists critic_score integer,
  add column if not exists critic_issues jsonb not null default '[]'::jsonb;
