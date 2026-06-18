-- 0007_task_engine.sql
-- The sacred loop:
--   prompt -> task -> (agent execution) -> handoff -> approval -> report -> event
-- Every user action flows through here. Agents are a global catalog; tasks,
-- handoffs, approvals, and events are org-scoped.

-- ---------------------------------------------------------------------------
-- ai_agents — global catalog of the six agents (not org-scoped; seeded).
-- ---------------------------------------------------------------------------
create table public.ai_agents (
  key          agent_key primary key,
  name         text not null,
  hub          hub,                            -- primary hub affinity (nullable: Associate spans all)
  role         text not null,
  color        text not null,                  -- workspace avatar color
  motion_style text,                           -- avatar animation hint
  capabilities text[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- prompts — raw user input that kicks off the loop (/prompt POST).
-- ---------------------------------------------------------------------------
create table public.prompts (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  principal_id    uuid not null references public.principals (id) on delete cascade,
  body            text not null,
  parsed_intent   jsonb,                       -- intent parser output
  routed_hub      hub,
  routed_agent    agent_key,
  created_at      timestamptz not null default now()
);

create index prompts_org_idx on public.prompts (organization_id);

-- ---------------------------------------------------------------------------
-- tasks — structured units of work (/task POST). Supports a parent for subtasks.
-- ---------------------------------------------------------------------------
create table public.tasks (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  prompt_id       uuid references public.prompts (id) on delete set null,
  parent_task_id  uuid references public.tasks (id) on delete cascade,
  title           text not null,
  description     text,
  hub             hub not null,
  assigned_agent  agent_key not null references public.ai_agents (key),
  status          task_status not null default 'pending',
  progress        numeric(4, 3) not null default 0,   -- 0..1
  graph_touched   graph_kind,                          -- which graph this updates, if any
  requires_approval boolean not null default true,
  result          jsonb,                                -- agent output / report payload
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  constraint progress_range check (progress >= 0 and progress <= 1)
);

create index tasks_org_idx on public.tasks (organization_id);
create index tasks_status_idx on public.tasks (organization_id, status);
create index tasks_agent_idx on public.tasks (assigned_agent);
create index tasks_parent_idx on public.tasks (parent_task_id);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- task_handoffs — transfer of a task between agents (/handoff POST).
-- ---------------------------------------------------------------------------
create table public.task_handoffs (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id         uuid not null references public.tasks (id) on delete cascade,
  from_agent      agent_key references public.ai_agents (key),
  to_agent        agent_key not null references public.ai_agents (key),
  reason          text,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index task_handoffs_org_idx on public.task_handoffs (organization_id);
create index task_handoffs_task_idx on public.task_handoffs (task_id);

-- ---------------------------------------------------------------------------
-- approvals — human-in-the-loop gate (/approve POST). Operators are never bypassed.
-- ---------------------------------------------------------------------------
create table public.approvals (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id         uuid not null references public.tasks (id) on delete cascade,
  requested_by_agent agent_key references public.ai_agents (key),
  summary         text not null,               -- what the agent proposes to do
  decision        approval_decision not null default 'pending',
  decided_by      uuid references public.principals (id) on delete set null,
  decided_at      timestamptz,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index approvals_org_idx on public.approvals (organization_id);
create index approvals_task_idx on public.approvals (task_id);
create index approvals_pending_idx on public.approvals (organization_id, decision)
  where decision = 'pending';

create trigger approvals_set_updated_at
  before update on public.approvals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- task_events — append-only event log mirroring the WebSocket event model.
-- task.created | task.progress | task.completed | task.handoff |
-- approval.requested | approval.response | graph.update
-- Realtime subscribers read this table; it is the durable record behind the
-- live workspace.
-- ---------------------------------------------------------------------------
create table public.task_events (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id         uuid references public.tasks (id) on delete cascade,
  event_type      text not null,
  agent           agent_key,
  hub             hub,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index task_events_org_idx on public.task_events (organization_id, created_at desc);
create index task_events_task_idx on public.task_events (task_id);
