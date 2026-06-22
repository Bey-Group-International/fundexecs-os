-- 0050_team_tasks_and_operator_feedback.sql
-- Human task loop + generalized learning ledger.
--
-- team_tasks gives Earn a principal-scoped queue: a teammate can assign work,
-- the assignee can launch it through Earn with the right context, and completion
-- is tracked apart from AI workflow steps.
--
-- operator_feedback is the cross-hub in-context learning ledger. It mirrors the
-- Source-specific source_feedback pattern, but records task/approval/completion
-- signals across the whole OS so future prompts can be personalized.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'team_task_priority') then
    create type public.team_task_priority as enum ('low', 'normal', 'high', 'urgent');
  end if;
end $$;

create table if not exists public.team_tasks (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  assigned_to      uuid not null references public.principals (id) on delete cascade,
  assigned_by      uuid references public.principals (id) on delete set null,
  title            text not null,
  description      text,
  hub              hub,
  module           text,
  priority         team_task_priority not null default 'normal',
  status           task_status not null default 'pending',
  due_at           timestamptz,
  session_id       uuid references public.sessions (id) on delete set null,
  source_task_id   uuid references public.tasks (id) on delete set null,
  deal_id          uuid references public.deals (id) on delete set null,
  asset_id         uuid references public.assets (id) on delete set null,
  context_snapshot jsonb not null default '{}'::jsonb,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists team_tasks_org_idx on public.team_tasks (organization_id);
create index if not exists team_tasks_assignee_status_idx
  on public.team_tasks (organization_id, assigned_to, status, due_at nulls last, created_at desc);
create index if not exists team_tasks_session_idx on public.team_tasks (session_id);

drop trigger if exists team_tasks_set_updated_at on public.team_tasks;
create trigger team_tasks_set_updated_at
  before update on public.team_tasks
  for each row execute function public.set_updated_at();

alter table public.team_tasks enable row level security;

drop policy if exists team_tasks_select on public.team_tasks;
create policy team_tasks_select on public.team_tasks
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists team_tasks_insert on public.team_tasks;
create policy team_tasks_insert on public.team_tasks
  for insert with check (public.is_org_writer(organization_id));

drop policy if exists team_tasks_update on public.team_tasks;
create policy team_tasks_update on public.team_tasks
  for update using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

drop policy if exists team_tasks_delete on public.team_tasks;
create policy team_tasks_delete on public.team_tasks
  for delete using (public.is_org_writer(organization_id));

create table if not exists public.operator_feedback (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  principal_id     uuid references public.principals (id) on delete set null,
  scope            text,
  module           text,
  agent            text,
  signal           text not null,
  subject          text not null,
  task_id          uuid references public.tasks (id) on delete set null,
  team_task_id     uuid references public.team_tasks (id) on delete set null,
  session_id       uuid references public.sessions (id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists operator_feedback_org_idx on public.operator_feedback (organization_id);
create index if not exists operator_feedback_lookup_idx
  on public.operator_feedback (organization_id, principal_id, scope, created_at desc);
create index if not exists operator_feedback_team_task_idx on public.operator_feedback (team_task_id);

alter table public.operator_feedback enable row level security;

drop policy if exists operator_feedback_select on public.operator_feedback;
create policy operator_feedback_select on public.operator_feedback
  for select using (organization_id in (select public.current_principal_org_ids()));

drop policy if exists operator_feedback_write on public.operator_feedback;
create policy operator_feedback_write on public.operator_feedback
  for all using (public.is_org_writer(organization_id))
  with check (public.is_org_writer(organization_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'team_tasks'
     ) then
    alter publication supabase_realtime add table public.team_tasks;
  end if;
end $$;
