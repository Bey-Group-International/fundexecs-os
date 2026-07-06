-- 20260707130000_office_program.sql
--
-- Persistence for the AI Execution Floor (the /command-center office program).
--
-- The floor runs as a local visual runtime, but the decisions it makes — which
-- workflows Earn routed and every command / assignment / gate / completion on
-- the audit trail — are mirrored here best-effort so a fund workspace keeps an
-- institutional record. Writes are additive and non-authoritative: the office
-- degrades gracefully to pure in-memory behavior when these tables are absent
-- (see components/virtual-office/program/office-actions.ts and the
-- OfficePersistenceSink in officeProgramStore.ts).
--
-- Org-scoped, member-read / writer-write RLS — same tenancy as the rest of the
-- domain (mirrors proactive_commands / office_approvals). Fully idempotent so a
-- preview-branch replay is a no-op.

-- ---------------------------------------------------------------------------
-- office_workflows — one row per workflow Earn routed on the floor. Keyed by
-- the client workflow id (workflow_key), unique within an org, so re-persisting
-- the same workflow (created → archived) upserts rather than duplicates.
-- ---------------------------------------------------------------------------
create table if not exists public.office_workflows (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  workflow_key     text not null,
  title            text not null,
  command_text     text not null default '',
  intent           text not null,
  mode             text not null,
  stage            text not null,
  risk_tier        text not null check (risk_tier in ('internal', 'external_facing', 'capital_binding')),
  progress         integer not null default 0,
  active_rooms     jsonb not null default '[]'::jsonb,
  assignment_count integer not null default 0,
  outcome          text check (outcome in ('complete', 'rejected')),
  created_by       uuid references public.principals (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (organization_id, workflow_key)
);

create index if not exists office_workflows_org_created_idx
  on public.office_workflows (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- office_audit_log — append-only institutional record of floor activity. Keyed
-- by the client event id (event_key) so a retried flush is idempotent.
-- ---------------------------------------------------------------------------
create table if not exists public.office_audit_log (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  event_key        text not null,
  actor            text not null,
  action           text not null,
  room             text not null default '',
  tier             text check (tier in ('internal', 'external_facing', 'capital_binding')),
  status           text not null default 'info'
                     check (status in ('info', 'pending', 'approved', 'rejected', 'complete')),
  recorded_by      uuid references public.principals (id) on delete set null,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (organization_id, event_key)
);

create index if not exists office_audit_log_org_time_idx
  on public.office_audit_log (organization_id, occurred_at desc);

-- Keep office_workflows.updated_at fresh on upsert.
drop trigger if exists office_workflows_set_updated_at on public.office_workflows;
create trigger office_workflows_set_updated_at
  before update on public.office_workflows
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — org members read; org writers (owner/admin/member) write. Mirrors the
-- rest of the domain's member-read / writer-write tenancy.
-- ---------------------------------------------------------------------------
alter table public.office_workflows enable row level security;
alter table public.office_audit_log enable row level security;

-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create to stay idempotent.
drop policy if exists office_workflows_select on public.office_workflows;
create policy office_workflows_select on public.office_workflows
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists office_workflows_write on public.office_workflows;
create policy office_workflows_write on public.office_workflows
  for all to authenticated
  using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists office_audit_log_select on public.office_audit_log;
create policy office_audit_log_select on public.office_audit_log
  for select to authenticated
  using (organization_id in (select public.current_principal_org_ids()));

-- Append-only: writers may insert; no update/delete policy is granted.
drop policy if exists office_audit_log_insert on public.office_audit_log;
create policy office_audit_log_insert on public.office_audit_log
  for insert to authenticated
  with check (public.is_org_writer(organization_id));
