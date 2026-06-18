-- 0016_automations.sql
-- Automations — saved, trigger-driven workflows. This is the leap from a
-- request/response Copilot (you prompt, you approve, it runs once) toward agents
-- that *own the work*: a saved natural-language instruction that fires on a
-- trigger and runs the full task-engine loop on its own.
--
-- The sacred approval loop is preserved. An automation opts IN to unattended
-- execution via `auto_approve`; otherwise every triggered run still queues an
-- approval for the operator, exactly like a Copilot prompt. The operator is
-- never bypassed unless they explicitly mark an automation as trusted.
--
-- This migration ships the foundation and the SCHEDULE trigger. The enum also
-- names the trigger types designed for later increments (email / webhook /
-- internal event), so the contract is forward-compatible without a future
-- enum migration.

create type trigger_type as enum (
  'schedule',  -- cron-style timer (built now), swept by /api/cron
  'manual',    -- run-now from the UI (built now)
  'email',     -- inbound email kicks off the run (designed; future)
  'webhook',   -- external HTTP POST kicks off the run (designed; future)
  'event'      -- internal domain event, e.g. deal.created (designed; future)
);

create table public.automations (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  -- the natural-language instruction; planned by Claude on every run, exactly
  -- like a Copilot prompt ("Every Monday, scan our deal pipeline and draft a
  -- one-page summary of what moved").
  prompt          text not null,
  trigger_type    trigger_type not null default 'schedule',
  -- 5-field cron expression for schedule triggers (UTC). Null for non-schedule.
  schedule        text,
  -- room for non-schedule trigger configuration (email label, webhook secret,
  -- event name) without a schema change when those triggers land.
  trigger_config  jsonb not null default '{}'::jsonb,
  -- opt-in autonomy: when true a triggered run auto-approves and executes
  -- end-to-end, unattended. When false the run queues an approval like any
  -- Copilot prompt. This is the "opt-in auto-approve" decision made explicit.
  auto_approve    boolean not null default false,
  enabled         boolean not null default true,
  last_run_at     timestamptz,
  last_run_status text,
  next_run_at     timestamptz,
  run_count       integer not null default 0,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index automations_org_idx on public.automations (organization_id, created_at desc);
-- The cron sweep finds due schedule automations with this partial index.
create index automations_due_idx on public.automations (next_run_at)
  where enabled and trigger_type = 'schedule';

create trigger automations_set_updated_at
  before update on public.automations
  for each row execute function public.set_updated_at();

-- Link a triggered run (workflow / parent task) back to the automation that
-- spawned it, so run history is just `tasks where automation_id = $1`.
alter table public.tasks
  add column automation_id uuid references public.automations (id) on delete set null;

create index tasks_automation_idx on public.tasks (automation_id);

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.automations enable row level security;

create policy automations_select on public.automations
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy automations_write on public.automations
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
