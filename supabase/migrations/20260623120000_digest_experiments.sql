-- 20260623120000_digest_experiments.sql
-- Subject-line A/B experiments for the Act-now Radar digest — the variant ledger
-- that closes the digest → engagement → winner loop.
--
-- The digest (0062) ships ranked Radar rows over in-app/Slack/email; engagement
-- (opens/clicks) is captured per send in radar_digest_engagement (0064). This
-- table records WHICH subject-line variant each send used, so the two can be
-- joined (via digest_log_id) to learn which variant drives more engagement and
-- prefer the winner on future sends.
--
--   digest_experiment_variants — one row per (send, experiment): the variant
--                                assigned to a radar_digest_log row. Deterministic
--                                assignment (lib/digest-experiments.ts) keeps a
--                                given org/period on a stable variant.
--
-- Uses the repo's go-forward timestamp migration naming (not a 00NN prefix) to
-- avoid out-of-order/duplicate-prefix collisions across parallel branches.
--
-- Org-scoped, with the same member-read / writer-write RLS as the rest of the
-- sourcing domain (radar_digest 0062, radar_digest_engagement 0064).

create table if not exists public.digest_experiment_variants (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- the digest send this assignment belongs to (radar_digest_log, 0062);
  -- null-tolerant + cascade so a vanishing log row never orphans the assignment.
  digest_log_id   uuid references public.radar_digest_log (id) on delete cascade,
  -- which experiment this assignment is for; one experiment ('subject_line') today,
  -- but keyed so more can be A/B'd over the same ledger without a schema change.
  experiment_key  text not null default 'subject_line',
  -- the assigned variant key (e.g. 'control' | 'urgent' | 'curiosity').
  variant         text not null,
  assigned_at     timestamptz not null default now()
);

create index if not exists digest_experiment_variants_org_idx
  on public.digest_experiment_variants (organization_id);

-- The performance summary groups by (org, experiment_key, variant); index that.
create index if not exists digest_experiment_variants_org_key_variant_idx
  on public.digest_experiment_variants (organization_id, experiment_key, variant);

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.digest_experiment_variants enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists digest_experiment_variants_select on public.digest_experiment_variants;
create policy digest_experiment_variants_select on public.digest_experiment_variants
  for select using (organization_id in (select public.current_principal_org_ids()));
drop policy if exists digest_experiment_variants_write on public.digest_experiment_variants;
create policy digest_experiment_variants_write on public.digest_experiment_variants
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
