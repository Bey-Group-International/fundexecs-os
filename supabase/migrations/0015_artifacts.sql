-- 0015_artifacts.sql
-- First-class deliverables. Every workflow step produces real work — an IC memo,
-- a model, a diligence report, an LP update. Until now that output lived only in
-- `tasks.result.output` (free text on the step row). This promotes it to a
-- durable, typed, queryable artifact: the system of record for what the agents
-- actually produced. Artifacts link back to the workflow (parent task) and the
-- step (child task) that authored them, and optionally to the deal they concern.

-- The kind of deliverable an agent produces. Coarse on purpose — enough to
-- route and badge in the UI without over-modeling early.
create type artifact_type as enum (
  'ic_memo',      -- investment committee recommendation
  'model',        -- pro forma / LBO / DCF / underwriting model
  'analysis',     -- analytical write-up, screen, comps
  'risk_report',  -- diligence findings / risk flags
  'lp_update',    -- LP communication / capital-call notice / report
  'memo',         -- general working memo
  'summary',      -- recap / synthesis of prior steps
  'other'
);

create table public.artifacts (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- the workflow (parent task) this deliverable belongs to
  workflow_id     uuid references public.tasks (id) on delete cascade,
  -- the step (child task) that authored it
  step_id         uuid references public.tasks (id) on delete cascade,
  -- optional link to the deal this deliverable concerns (set as the Deal graph fills in)
  deal_id         uuid references public.deals (id) on delete set null,
  title           text not null,
  artifact_type   artifact_type not null default 'memo',
  agent           agent_key references public.ai_agents (key),
  hub             hub,
  content         text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index artifacts_org_idx on public.artifacts (organization_id, created_at desc);
create index artifacts_workflow_idx on public.artifacts (workflow_id);
create index artifacts_step_idx on public.artifacts (step_id);
create index artifacts_deal_idx on public.artifacts (deal_id);

create trigger artifacts_set_updated_at
  before update on public.artifacts
  for each row execute function public.set_updated_at();

-- RLS: same member-read / writer-write tenancy as the rest of the domain.
alter table public.artifacts enable row level security;

create policy artifacts_select on public.artifacts
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy artifacts_write on public.artifacts
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

-- Stream new deliverables to the live Copilot alongside task_events.
alter publication supabase_realtime add table public.artifacts;
