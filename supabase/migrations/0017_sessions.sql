-- 0017_sessions.sql
-- Sessions — the first-class unit of operation. An operator starts a SESSION
-- (an Earn conversation that plans + runs work); a WORKFLOW is simply an
-- automated session (it fires on a trigger and spawns a session on each run).
-- Sessions can be named and filed into groups for organization.
--
-- Relationship to the task engine: a session OWNS one or more workflow runs
-- (parent `tasks` rows). We link them via `tasks.session_id` rather than
-- restructuring the engine, so the existing prompt -> workflow -> steps spine
-- is preserved.

-- Where a session originated.
create type session_origin as enum (
  'earn',      -- started by a person in the Earn copilot
  'workflow'   -- spawned by an automated workflow (an "automation") firing
);

-- Optional folders for organizing sessions.
create table public.session_groups (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index session_groups_org_idx on public.session_groups (organization_id, created_at desc);

create table public.sessions (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  group_id        uuid references public.session_groups (id) on delete set null,
  origin          session_origin not null default 'earn',
  -- set when origin = 'workflow': the automation whose run created this session
  automation_id   uuid references public.automations (id) on delete set null,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index sessions_org_idx on public.sessions (organization_id, created_at desc);
create index sessions_group_idx on public.sessions (group_id);
create index sessions_automation_idx on public.sessions (automation_id);

-- A workflow run (parent task) belongs to a session.
alter table public.tasks
  add column session_id uuid references public.sessions (id) on delete set null;

create index tasks_session_idx on public.tasks (session_id);

create trigger session_groups_set_updated_at
  before update on public.session_groups
  for each row execute function public.set_updated_at();

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function public.set_updated_at();

-- RLS: same member-read / writer-write org tenancy as the rest of the domain.
alter table public.session_groups enable row level security;
alter table public.sessions enable row level security;

create policy session_groups_select on public.session_groups
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy session_groups_write on public.session_groups
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

create policy sessions_select on public.sessions
  for select using (organization_id in (select public.current_principal_org_ids()));
create policy sessions_write on public.sessions
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));
