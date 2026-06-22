-- 0064_artifact_grounding.sql
-- Trust layer, phase 2: the automated half of "verified". Alongside the cited
-- `sources` (migration 0063), every artifact now carries an aggregate
-- `grounding_score` in [0,1] — how much of the output actually reflects the
-- passages it cited. Computed deterministically at execution time; the human
-- approval gate remains the authoritative sign-off on top of it.

alter table public.artifacts
  add column if not exists grounding_score numeric not null default 0;
