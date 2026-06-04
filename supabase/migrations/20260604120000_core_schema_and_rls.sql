-- =====================================================================
-- FundExecs OS — core schema + Row Level Security (Phase 2 foundation)
-- Multi-tenant, org-scoped. The app uses the anon key, so RLS is the
-- access boundary on every table.
-- =====================================================================

-- ---------- enums ----------
create type public.org_member_role as enum ('owner', 'admin', 'member');
create type public.org_type as enum (
  'fund', 'lp', 'operator', 'capital_provider', 'service_provider', 'partner'
);

-- ---------- updated_at helper ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- tables ----------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.org_type,
  tier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);
create index org_members_org_id_idx on public.org_members (org_id);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  stage text not null default 'sourcing',
  status text not null default 'open',
  amount numeric(18, 2),
  owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_org_id_idx on public.deals (org_id);

create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  deal_id uuid not null references public.deals (id) on delete cascade,
  lp_id uuid references public.organizations (id) on delete set null,
  amount numeric(18, 2),
  status text not null default 'proposed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index allocations_org_id_idx on public.allocations (org_id);
create index allocations_deal_id_idx on public.allocations (deal_id);

create table public.partnerships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  counterparty text not null,
  type text,
  stage text not null default 'prospect',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index partnerships_org_id_idx on public.partnerships (org_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  assignee_id uuid references public.profiles (id) on delete set null,
  title text not null,
  description text,
  due_at timestamptz,
  status text not null default 'todo',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_org_id_idx on public.tasks (org_id);
create index tasks_assignee_id_idx on public.tasks (assignee_id);

-- Append-only audit log powering the Chain of Trust (no update/delete policies).
create table public.trust_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index trust_events_org_id_idx on public.trust_events (org_id);
create index trust_events_entity_idx on public.trust_events (entity_type, entity_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_id_idx on public.notifications (user_id);

-- ---------- updated_at triggers ----------
create trigger set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.deals
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.allocations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.partnerships
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------- security-definer helpers (prevent RLS recursion) ----------
create or replace function public.is_org_member(_org_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(_org_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.shares_org(_user_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1
    from public.org_members a
    join public.org_members b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = _user_id
  );
$$;

-- ---------- auto-create a profile row on signup ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- atomic org creation + owner membership (bypasses RLS safely) ----------
create or replace function public.create_organization(_name text, _type public.org_type default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to create an organization';
  end if;
  insert into public.organizations (name, type) values (_name, _type)
  returning id into _org_id;
  insert into public.org_members (org_id, user_id, role)
  values (_org_id, auth.uid(), 'owner');
  return _org_id;
end;
$$;

revoke all on function public.create_organization(text, public.org_type) from public, anon;
grant execute on function public.create_organization(text, public.org_type) to authenticated;

-- ---------- enable RLS ----------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.org_members enable row level security;
alter table public.deals enable row level security;
alter table public.allocations enable row level security;
alter table public.partnerships enable row level security;
alter table public.tasks enable row level security;
alter table public.trust_events enable row level security;
alter table public.notifications enable row level security;

-- ---------- policies ----------
-- organizations (insert is via create_organization(); no direct insert policy)
create policy "members view their orgs" on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy "admins update their org" on public.organizations
  for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));
create policy "owners delete their org" on public.organizations
  for delete to authenticated using (public.is_org_admin(id));

-- profiles
create policy "view own or co-member profiles" on public.profiles
  for select to authenticated using (id = auth.uid() or public.shares_org(id));
create policy "insert own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- org_members
create policy "members view co-members" on public.org_members
  for select to authenticated using (public.is_org_member(org_id));
create policy "admins manage members" on public.org_members
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- deals
create policy "members read deals" on public.deals
  for select to authenticated using (public.is_org_member(org_id));
create policy "members insert deals" on public.deals
  for insert to authenticated with check (public.is_org_member(org_id));
create policy "members update deals" on public.deals
  for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "admins delete deals" on public.deals
  for delete to authenticated using (public.is_org_admin(org_id));

-- allocations
create policy "members read allocations" on public.allocations
  for select to authenticated using (public.is_org_member(org_id));
create policy "members insert allocations" on public.allocations
  for insert to authenticated with check (public.is_org_member(org_id));
create policy "members update allocations" on public.allocations
  for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "admins delete allocations" on public.allocations
  for delete to authenticated using (public.is_org_admin(org_id));

-- partnerships
create policy "members read partnerships" on public.partnerships
  for select to authenticated using (public.is_org_member(org_id));
create policy "members insert partnerships" on public.partnerships
  for insert to authenticated with check (public.is_org_member(org_id));
create policy "members update partnerships" on public.partnerships
  for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "admins delete partnerships" on public.partnerships
  for delete to authenticated using (public.is_org_admin(org_id));

-- tasks
create policy "members read tasks" on public.tasks
  for select to authenticated using (public.is_org_member(org_id));
create policy "members insert tasks" on public.tasks
  for insert to authenticated with check (public.is_org_member(org_id));
create policy "members update tasks" on public.tasks
  for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "admins delete tasks" on public.tasks
  for delete to authenticated using (public.is_org_admin(org_id));

-- trust_events: append-only (select + insert only; no update/delete policies)
create policy "members read trust_events" on public.trust_events
  for select to authenticated using (public.is_org_member(org_id));
create policy "members append trust_events" on public.trust_events
  for insert to authenticated with check (public.is_org_member(org_id));

-- notifications: strictly user-scoped
create policy "view own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "update own notifications" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
