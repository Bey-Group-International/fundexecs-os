-- 0002_identity.sql
-- Tenancy + identity. The Build hub's foundation: who the operator is and the
-- organization (GP firm / family office) they run.

-- ---------------------------------------------------------------------------
-- principals — a person. 1:1 with auth.users.
-- ---------------------------------------------------------------------------
create table public.principals (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  title         text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger principals_set_updated_at
  before update on public.principals
  for each row execute function public.set_updated_at();

-- Mirror new auth users into principals automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.principals (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- organizations — the tenant root (GP firm, family office, advisory shop).
-- Also carries Build hub "Profile / Brand / Entity" identity fields.
-- ---------------------------------------------------------------------------
create table public.organizations (
  id              uuid primary key default extensions.gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  legal_name      text,
  entity_type     text,                       -- LLC, LP, Inc., etc.
  jurisdiction    text,
  website         text,
  logo_url        text,
  brand_color     text,
  description     text,
  created_by      uuid references public.principals (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organization_members — principal <-> organization with a role (the Team).
-- ---------------------------------------------------------------------------
create table public.organization_members (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  principal_id    uuid not null references public.principals (id) on delete cascade,
  role            member_role not null default 'member',
  created_at      timestamptz not null default now(),
  unique (organization_id, principal_id)
);

create index organization_members_principal_idx on public.organization_members (principal_id);
create index organization_members_org_idx on public.organization_members (organization_id);

-- ---------------------------------------------------------------------------
-- Membership helper functions. Defined here (not in 0001) because they read
-- `organization_members`, which must exist before the function bodies are
-- validated. Used by nearly every RLS policy in 0010_rls.sql.
-- ---------------------------------------------------------------------------

-- Set of organization ids the current authenticated principal belongs to.
-- SECURITY DEFINER so RLS policies can call it without recursing into the
-- organization_members policy.
create or replace function public.current_principal_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where principal_id = auth.uid();
$$;

-- True if the current principal has owner/admin rights in the given org.
create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where principal_id = auth.uid()
      and organization_id = target_org
      and role in ('owner', 'admin')
  );
$$;
