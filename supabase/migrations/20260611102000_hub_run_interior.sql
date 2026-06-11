-- ============================================================================
-- Hub RUN interior data model.
--
-- Additive + idempotent. Org members read RUN state; service_role writes from
-- the orchestrator and automation runners.
-- ============================================================================

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  stream text not null,
  name text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists workflows_id_org_unique
  on public.workflows (id, org_id);
create index if not exists workflows_org_stream_idx
  on public.workflows (org_id, stream);

create table if not exists public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  workflow_id uuid not null,
  status text not null default 'todo',
  subtasks jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (workflow_id, org_id)
    references public.workflows (id, org_id)
    on delete cascade
);

create index if not exists workflow_tasks_workflow_status_idx
  on public.workflow_tasks (workflow_id, status);
create index if not exists workflow_tasks_org_status_idx
  on public.workflow_tasks (org_id, status);

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  on_event text not null,
  enabled boolean not null default true,
  last_run_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists automations_org_enabled_idx
  on public.automations (org_id, enabled);
create index if not exists automations_org_event_idx
  on public.automations (org_id, on_event);

create table if not exists public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  category text not null,
  severity text not null,
  status text not null default 'open',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists compliance_items_org_status_idx
  on public.compliance_items (org_id, status);
create index if not exists compliance_items_org_severity_idx
  on public.compliance_items (org_id, severity);

create table if not exists public.ir_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  cat text not null,
  status text not null default 'todo',
  due_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists ir_items_org_status_idx
  on public.ir_items (org_id, status);
create index if not exists ir_items_due_at_idx
  on public.ir_items (due_at);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workflows'::regclass
      and conname = 'workflows_stream_not_blank'
  ) then
    alter table public.workflows
      add constraint workflows_stream_not_blank
      check (length(btrim(stream)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workflows'::regclass
      and conname = 'workflows_name_not_blank'
  ) then
    alter table public.workflows
      add constraint workflows_name_not_blank
      check (length(btrim(name)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workflow_tasks'::regclass
      and conname = 'workflow_tasks_subtasks_array_check'
  ) then
    alter table public.workflow_tasks
      add constraint workflow_tasks_subtasks_array_check
      check (jsonb_typeof(subtasks) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.automations'::regclass
      and conname = 'automations_on_event_not_blank'
  ) then
    alter table public.automations
      add constraint automations_on_event_not_blank
      check (length(btrim(on_event)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compliance_items'::regclass
      and conname = 'compliance_items_category_not_blank'
  ) then
    alter table public.compliance_items
      add constraint compliance_items_category_not_blank
      check (length(btrim(category)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compliance_items'::regclass
      and conname = 'compliance_items_severity_not_blank'
  ) then
    alter table public.compliance_items
      add constraint compliance_items_severity_not_blank
      check (length(btrim(severity)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ir_items'::regclass
      and conname = 'ir_items_cat_not_blank'
  ) then
    alter table public.ir_items
      add constraint ir_items_cat_not_blank
      check (length(btrim(cat)) > 0);
  end if;
end$$;

do $$
declare
  _table regclass;
begin
  foreach _table in array array[
    'public.workflows'::regclass,
    'public.workflow_tasks'::regclass,
    'public.automations'::regclass,
    'public.compliance_items'::regclass,
    'public.ir_items'::regclass
  ]
  loop
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'set_updated_at'
        and tgrelid = _table
    ) then
      execute format(
        'create trigger set_updated_at before update on %s for each row execute function public.set_updated_at()',
        _table
      );
    end if;
  end loop;
end$$;

alter table public.workflows enable row level security;
alter table public.workflow_tasks enable row level security;
alter table public.automations enable row level security;
alter table public.compliance_items enable row level security;
alter table public.ir_items enable row level security;

revoke all on table public.workflows from anon, authenticated;
revoke all on table public.workflow_tasks from anon, authenticated;
revoke all on table public.automations from anon, authenticated;
revoke all on table public.compliance_items from anon, authenticated;
revoke all on table public.ir_items from anon, authenticated;

grant select on table public.workflows to authenticated;
grant select on table public.workflow_tasks to authenticated;
grant select on table public.automations to authenticated;
grant select on table public.compliance_items to authenticated;
grant select on table public.ir_items to authenticated;

grant select, insert, update, delete on table public.workflows to service_role;
grant select, insert, update, delete on table public.workflow_tasks to service_role;
grant select, insert, update, delete on table public.automations to service_role;
grant select, insert, update, delete on table public.compliance_items to service_role;
grant select, insert, update, delete on table public.ir_items to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workflows'
      and policyname = 'members read workflows'
  ) then
    create policy "members read workflows" on public.workflows
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workflow_tasks'
      and policyname = 'members read workflow_tasks'
  ) then
    create policy "members read workflow_tasks" on public.workflow_tasks
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'automations'
      and policyname = 'members read automations'
  ) then
    create policy "members read automations" on public.automations
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'compliance_items'
      and policyname = 'members read compliance_items'
  ) then
    create policy "members read compliance_items" on public.compliance_items
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ir_items'
      and policyname = 'members read ir_items'
  ) then
    create policy "members read ir_items" on public.ir_items
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workflows'
      and policyname = 'service_role manage workflows'
  ) then
    create policy "service_role manage workflows" on public.workflows
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workflow_tasks'
      and policyname = 'service_role manage workflow_tasks'
  ) then
    create policy "service_role manage workflow_tasks" on public.workflow_tasks
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'automations'
      and policyname = 'service_role manage automations'
  ) then
    create policy "service_role manage automations" on public.automations
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'compliance_items'
      and policyname = 'service_role manage compliance_items'
  ) then
    create policy "service_role manage compliance_items" on public.compliance_items
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ir_items'
      and policyname = 'service_role manage ir_items'
  ) then
    create policy "service_role manage ir_items" on public.ir_items
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;

comment on table public.workflows is
  'RUN hub kanban workflow streams.';
comment on table public.workflow_tasks is
  'RUN hub workflow task state and nested subtasks.';
comment on table public.automations is
  'RUN hub automation trigger state using on_event to avoid quoted trigger column names.';
comment on table public.compliance_items is
  'RUN hub compliance queue with counsel-in-the-loop status.';
comment on table public.ir_items is
  'RUN hub investor-relations deliverables.';
