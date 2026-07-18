-- 20260718140000_skill_runs.sql
-- The skill-run ledger — an accountable execution record for every native skill
-- run (lib/skills/*). A workflow is not "done" because the AI produced text; it
-- is done when the correct skill ran, validated its I/O, resolved an approval
-- tier, and left a durable, provenanced record. This table IS that record.
--
-- One row = one skill execution. It links to the session and the workflow task
-- it ran under, carries the structured input/output + sources (fact / assumption
-- / calculation / generated) + validation outcomes, records the executive that
-- ran it and the gate tier its follow-on requires, and stamps provider/model for
-- the inference gateway. Org-scoped, member-read / writer-write RLS, same tenancy
-- as the rest of the domain. Idempotent so a preview-branch replay is a no-op.

create table if not exists public.skill_runs (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- The skill + version that ran (lib/skills/registry.ts).
  skill_id          text not null,
  skill_version     text not null,
  -- The operational executive that ran it (lib/executives/registry.ts) + the
  -- execution agent it is backed by.
  executive_key     text not null,
  backing_agent     text,
  -- The operating session + workflow task this ran under (both optional: a skill
  -- can run standalone, e.g. from the API).
  session_id        uuid references public.sessions (id) on delete set null,
  workflow_task_id  uuid references public.tasks (id) on delete set null,
  status            text not null default 'succeeded'
                      check (status in ('succeeded', 'failed', 'rejected')),
  -- The gate tier the follow-on action requires + whether a human sign-off is
  -- needed before it can proceed (lib/gates.ts).
  approval_tier     integer not null default 1 check (approval_tier between 1 and 3),
  requires_approval boolean not null default false,
  risk              text not null default 'low'
                      check (risk in ('low', 'moderate', 'elevated', 'high')),
  confidence        numeric not null default 0,
  completeness      numeric not null default 0,
  -- The validated structured input + output, the provenance sources, the flagged
  -- missing inputs, and the input/output validation outcomes.
  input             jsonb not null default '{}'::jsonb,
  output            jsonb,
  sources           jsonb not null default '[]'::jsonb,
  missing_data      jsonb not null default '[]'::jsonb,
  validation        jsonb not null default '{}'::jsonb,
  -- Inference-gateway telemetry (null for deterministic runs).
  provider          text,
  model             text,
  -- The deliverable this run produced, if any.
  artifact_id       uuid references public.artifacts (id) on delete set null,
  error             text,
  created_by        uuid references public.principals (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists skill_runs_org_created_idx
  on public.skill_runs (organization_id, created_at desc);
create index if not exists skill_runs_org_skill_idx
  on public.skill_runs (organization_id, skill_id);
create index if not exists skill_runs_session_idx
  on public.skill_runs (session_id);

drop trigger if exists skill_runs_set_updated_at on public.skill_runs;
create trigger skill_runs_set_updated_at
  before update on public.skill_runs
  for each row execute function public.set_updated_at();

-- RLS — member-read / writer-write org tenancy, as elsewhere.
alter table public.skill_runs enable row level security;

drop policy if exists skill_runs_select on public.skill_runs;
create policy skill_runs_select on public.skill_runs
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists skill_runs_write on public.skill_runs;
create policy skill_runs_write on public.skill_runs
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- Realtime — the session workspace subscribes to skill runs to prove work.
do $$
begin
  alter publication supabase_realtime add table public.skill_runs;
exception when duplicate_object then null;
end $$;
