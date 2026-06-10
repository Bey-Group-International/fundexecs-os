-- ============================================================================
-- earn_workflows + earn_workflow_steps — XP-gated Earn workflow engine.
--
-- Earn workflows are multi-step sequences executed by AI specialists, gated
-- at Level 3 (400 XP). The data model records the workflow envelope and each
-- numbered step's lifecycle.
--
-- RLS: org-scoped — active org members read and write their own org's rows.
-- Writes to both tables are gated to members of the row's org. The engine's
-- server actions call through the user-scoped Supabase client, so the member
-- policies enforce the boundary automatically.
--
-- Additive + idempotent: `create table if not exists`, `add column if not
-- exists`, idempotent index creation, `drop policy if exists` before create.
-- Safe to re-apply in full against an existing schema.
-- ============================================================================

-- ============================================================================
-- earn_workflows — the workflow envelope.
-- ============================================================================
create table if not exists public.earn_workflows (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  created_by   uuid not null references public.profiles (id) on delete cascade,
  -- Short machine kind, e.g. 'lp_outreach' | 'deal_diligence'.
  kind         text not null check (char_length(kind) between 1 and 128),
  -- Lifecycle: pending → running → done | failed | aborted.
  status       text not null default 'pending'
                 check (status in ('pending', 'running', 'done', 'failed', 'aborted')),
  -- Ordinal of the step currently being worked on (0-based).
  current_step int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Per-org listing (status board, sidebar badge) and per-user history.
create index if not exists earn_workflows_org_status_idx
  on public.earn_workflows (org_id, status, created_at desc);
create index if not exists earn_workflows_created_by_idx
  on public.earn_workflows (created_by, created_at desc);

-- Automatically bump updated_at on any row change (mirrors tasks idiom).
create or replace function public.touch_earn_workflow_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists earn_workflows_updated_at on public.earn_workflows;
create trigger earn_workflows_updated_at
  before update on public.earn_workflows
  for each row execute procedure public.touch_earn_workflow_updated_at();

-- RLS — active org members read and write their own org's workflows.
alter table public.earn_workflows enable row level security;

revoke all on table public.earn_workflows from anon, authenticated;
grant select, insert, update on table public.earn_workflows to authenticated;
grant select, insert, update, delete on table public.earn_workflows to service_role;

drop policy if exists "members read earn_workflows" on public.earn_workflows;
create policy "members read earn_workflows"
  on public.earn_workflows
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists "members insert earn_workflows" on public.earn_workflows;
create policy "members insert earn_workflows"
  on public.earn_workflows
  for insert to authenticated
  with check (private.is_org_member(org_id));

drop policy if exists "members update earn_workflows" on public.earn_workflows;
create policy "members update earn_workflows"
  on public.earn_workflows
  for update to authenticated
  using (private.is_org_member(org_id));

-- ============================================================================
-- earn_workflow_steps — one row per step within a workflow.
-- ============================================================================
create table if not exists public.earn_workflow_steps (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     uuid not null references public.earn_workflows (id) on delete cascade,
  -- 0-based position within the workflow.
  ordinal         int  not null default 0,
  -- Operator-visible step label.
  title           text not null check (char_length(title) between 1 and 512),
  -- Canonical specialist slug from TEAM_ROSTER; null = COO handles it.
  specialist_slug text check (
    specialist_slug is null or specialist_slug in (
      'earnest-fundmaker', 'master-workflow', 'automater', 'executive-advisor',
      'rainmaker', 'deal-sourcer', 'capital-connector', 'legal-admin',
      'pr-director', 'seo-disruptor', 'lead-generator', 'event-curator',
      'investor-relations', 'capital-raiser', 'workflow-instructor'
    )
  ),
  -- Step lifecycle: mirrors WorkflowStepStatus in lib/workflows/types.ts.
  status          text not null default 'pending'
                    check (status in (
                      'pending', 'active', 'awaiting_approval', 'done', 'skipped', 'failed'
                    )),
  -- Structured result JSON (specialist output, approval notes, etc.).
  result          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Each step is uniquely positioned within its workflow.
create unique index if not exists earn_workflow_steps_workflow_ordinal_idx
  on public.earn_workflow_steps (workflow_id, ordinal);

-- Fast lookup of all steps for a workflow (engine reads these in ordinal order).
create index if not exists earn_workflow_steps_workflow_idx
  on public.earn_workflow_steps (workflow_id, ordinal asc);

-- Auto-bump updated_at.
create or replace function public.touch_earn_workflow_step_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists earn_workflow_steps_updated_at on public.earn_workflow_steps;
create trigger earn_workflow_steps_updated_at
  before update on public.earn_workflow_steps
  for each row execute procedure public.touch_earn_workflow_step_updated_at();

-- RLS — steps inherit org scope via the parent workflow's org_id. The helper
-- `private.is_org_member` checks the caller's uid against org_members; we
-- join to earn_workflows to derive the org_id for each step row.
alter table public.earn_workflow_steps enable row level security;

revoke all on table public.earn_workflow_steps from anon, authenticated;
grant select, insert, update on table public.earn_workflow_steps to authenticated;
grant select, insert, update, delete on table public.earn_workflow_steps to service_role;

drop policy if exists "members read earn_workflow_steps" on public.earn_workflow_steps;
create policy "members read earn_workflow_steps"
  on public.earn_workflow_steps
  for select to authenticated
  using (
    exists (
      select 1 from public.earn_workflows ew
      where ew.id = earn_workflow_steps.workflow_id
        and private.is_org_member(ew.org_id)
    )
  );

drop policy if exists "members insert earn_workflow_steps" on public.earn_workflow_steps;
create policy "members insert earn_workflow_steps"
  on public.earn_workflow_steps
  for insert to authenticated
  with check (
    exists (
      select 1 from public.earn_workflows ew
      where ew.id = earn_workflow_steps.workflow_id
        and private.is_org_member(ew.org_id)
    )
  );

drop policy if exists "members update earn_workflow_steps" on public.earn_workflow_steps;
create policy "members update earn_workflow_steps"
  on public.earn_workflow_steps
  for update to authenticated
  using (
    exists (
      select 1 from public.earn_workflows ew
      where ew.id = earn_workflow_steps.workflow_id
        and private.is_org_member(ew.org_id)
    )
  );
