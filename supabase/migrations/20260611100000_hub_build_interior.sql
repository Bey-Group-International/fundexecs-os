-- ============================================================================
-- Hub BUILD interior data model.
--
-- Additive + idempotent. Org-scoped records are readable by authenticated
-- org members and written by the server-side orchestrator through service_role.
-- ============================================================================

create table if not exists public.fund_formations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  status text not null default 'in_progress',
  story jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists fund_formations_org_unique
  on public.fund_formations (org_id);
create unique index if not exists fund_formations_id_org_unique
  on public.fund_formations (id, org_id);
create index if not exists fund_formations_org_status_idx
  on public.fund_formations (org_id, status);

create table if not exists public.formation_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  formation_id uuid not null,
  kind text not null,
  seq integer not null,
  status text not null default 'todo',
  data jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  foreign key (formation_id, org_id)
    references public.fund_formations (id, org_id)
    on delete cascade
);

create unique index if not exists formation_steps_formation_kind_unique
  on public.formation_steps (formation_id, kind);
create index if not exists formation_steps_org_status_idx
  on public.formation_steps (org_id, status);
create index if not exists formation_steps_formation_seq_idx
  on public.formation_steps (formation_id, seq);

create table if not exists public.governance_bodies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  members jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists governance_bodies_org_kind_unique
  on public.governance_bodies (org_id, kind);
create index if not exists governance_bodies_org_id_idx
  on public.governance_bodies (org_id);

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  kind text not null,
  status text not null default 'todo',
  body jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists policies_org_status_idx
  on public.policies (org_id, status);
create index if not exists policies_org_kind_idx
  on public.policies (org_id, kind);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.formation_steps'::regclass
      and conname = 'formation_steps_kind_check'
  ) then
    alter table public.formation_steps
      add constraint formation_steps_kind_check
      check (kind in ('entity', 'lpa', 'ppm', 'subdocs', 'regd', 'bank'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.formation_steps'::regclass
      and conname = 'formation_steps_status_check'
  ) then
    alter table public.formation_steps
      add constraint formation_steps_status_check
      check (status in ('todo', 'drafting', 'ready', 'filed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.formation_steps'::regclass
      and conname = 'formation_steps_seq_check'
  ) then
    alter table public.formation_steps
      add constraint formation_steps_seq_check
      check (seq > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.governance_bodies'::regclass
      and conname = 'governance_bodies_kind_check'
  ) then
    alter table public.governance_bodies
      add constraint governance_bodies_kind_check
      check (kind in (
        'ic',
        'lpac',
        'advisory',
        'fund_mgmt',
        'capital_partners',
        'legal_counsel'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.governance_bodies'::regclass
      and conname = 'governance_bodies_members_array_check'
  ) then
    alter table public.governance_bodies
      add constraint governance_bodies_members_array_check
      check (jsonb_typeof(members) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.policies'::regclass
      and conname = 'policies_status_check'
  ) then
    alter table public.policies
      add constraint policies_status_check
      check (status in ('todo', 'drafting', 'active'));
  end if;
end$$;

do $$
declare
  _table regclass;
begin
  foreach _table in array array[
    'public.fund_formations'::regclass,
    'public.formation_steps'::regclass,
    'public.governance_bodies'::regclass,
    'public.policies'::regclass
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

alter table public.fund_formations enable row level security;
alter table public.formation_steps enable row level security;
alter table public.governance_bodies enable row level security;
alter table public.policies enable row level security;

revoke all on table public.fund_formations from anon, authenticated;
revoke all on table public.formation_steps from anon, authenticated;
revoke all on table public.governance_bodies from anon, authenticated;
revoke all on table public.policies from anon, authenticated;

grant select on table public.fund_formations to authenticated;
grant select on table public.formation_steps to authenticated;
grant select on table public.governance_bodies to authenticated;
grant select on table public.policies to authenticated;

grant select, insert, update, delete on table public.fund_formations to service_role;
grant select, insert, update, delete on table public.formation_steps to service_role;
grant select, insert, update, delete on table public.governance_bodies to service_role;
grant select, insert, update, delete on table public.policies to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'fund_formations'
      and policyname = 'members read fund_formations'
  ) then
    create policy "members read fund_formations" on public.fund_formations
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'formation_steps'
      and policyname = 'members read formation_steps'
  ) then
    create policy "members read formation_steps" on public.formation_steps
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'governance_bodies'
      and policyname = 'members read governance_bodies'
  ) then
    create policy "members read governance_bodies" on public.governance_bodies
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'policies'
      and policyname = 'members read policies'
  ) then
    create policy "members read policies" on public.policies
      for select to authenticated
      using (private.is_org_member(org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'fund_formations'
      and policyname = 'service_role manage fund_formations'
  ) then
    create policy "service_role manage fund_formations" on public.fund_formations
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'formation_steps'
      and policyname = 'service_role manage formation_steps'
  ) then
    create policy "service_role manage formation_steps" on public.formation_steps
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'governance_bodies'
      and policyname = 'service_role manage governance_bodies'
  ) then
    create policy "service_role manage governance_bodies" on public.governance_bodies
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'policies'
      and policyname = 'service_role manage policies'
  ) then
    create policy "service_role manage policies" on public.policies
      for all to service_role
      using (true)
      with check (true);
  end if;
end$$;

comment on table public.fund_formations is
  'BUILD hub fund-formation record, one per organization.';
comment on table public.formation_steps is
  'BUILD hub formation checklist steps for entity, fund docs, filings, and bank readiness.';
comment on table public.governance_bodies is
  'BUILD hub governance body roster snapshots for IC, LPAC, advisory, and counsel loops.';
comment on table public.policies is
  'BUILD hub governance policies and drafting state.';
