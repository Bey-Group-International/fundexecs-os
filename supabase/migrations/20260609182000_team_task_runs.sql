-- Team-task automation (Phase 2) — gated execution scaffold.
--
-- A `task_run` is a *proposed* action a specialist would take on a task. The
-- operator approves or rejects it on a confirm card before anything is treated
-- as authorized; nothing executes against external systems in this phase. Each
-- propose / approve / reject is also written to the append-only `trust_events`
-- log (the Chain-of-Trust audit), so the desk has a tamper-evident record of
-- who authorized what and when.
--
-- RLS uses the relocated helpers in the non-exposed `private` schema
-- (`private.is_org_member` / `private.is_org_admin`), matching how
-- public.tasks is secured after 20260604120500_harden_security_definer_helpers.

create table if not exists public.task_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  agent_slug text not null,
  -- The plan shown on the confirm card: a one-line action + ordered steps.
  action text not null,
  steps jsonb not null default '[]'::jsonb,
  status text not null default 'proposed',
  proposed_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_runs_status_check check (status in ('proposed', 'approved', 'rejected')),
  constraint task_runs_agent_slug_check check (
    agent_slug in (
      'earnest-fundmaker', 'master-workflow', 'automater', 'executive-advisor',
      'rainmaker', 'deal-sourcer', 'capital-connector', 'legal-admin',
      'pr-director', 'seo-disruptor', 'lead-generator', 'event-curator',
      'investor-relations', 'capital-raiser', 'workflow-instructor'
    )
  )
);

-- One open proposal per task at a time: a partial unique index over the
-- 'proposed' status keeps `runTask` idempotent and prevents duplicate cards.
create unique index if not exists task_runs_one_open_per_task_idx
  on public.task_runs (task_id)
  where status = 'proposed';

-- Board lookup: pending proposals per org.
create index if not exists task_runs_org_status_idx
  on public.task_runs (org_id, status);

drop trigger if exists set_updated_at on public.task_runs;
create trigger set_updated_at before update on public.task_runs
  for each row execute function public.set_updated_at();

alter table public.task_runs enable row level security;

-- RLS mirrors public.tasks: org members read / insert / update their org's
-- runs; admins may delete. is_org_member / is_org_admin are the SECURITY
-- DEFINER helpers in the non-exposed `private` schema.
drop policy if exists "members read task_runs" on public.task_runs;
create policy "members read task_runs" on public.task_runs
  for select to authenticated using (private.is_org_member(org_id));
drop policy if exists "members insert task_runs" on public.task_runs;
create policy "members insert task_runs" on public.task_runs
  for insert to authenticated with check (private.is_org_member(org_id));
drop policy if exists "members update task_runs" on public.task_runs;
create policy "members update task_runs" on public.task_runs
  for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
drop policy if exists "admins delete task_runs" on public.task_runs;
create policy "admins delete task_runs" on public.task_runs
  for delete to authenticated using (private.is_org_admin(org_id));
