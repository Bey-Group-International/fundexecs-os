-- Build > Team: team members who have no login.
--
-- A fund's team page has to be complete even when not everyone on the team has
-- (or needs) a FundExecs account -- a free plan has few seats, and an advisor or
-- a partner who never opens the app still belongs in the data room and the LP
-- materials. `organization_members` cannot hold them: every row there is tied to
-- a `principals` row, which is 1:1 with auth.users, and counts as a seat.
--
-- `team_profiles` holds the same display fields (name, title, bio, photo, email)
-- for a person with NO access to the system. A row here:
--   - is not a login and never appears in organization_members,
--   - does not use a seat,
--   - is shown on the Team page and in the data room team section,
--   - can be linked to a real account later (linked_principal_id), at which point
--     the profile is merged into that member and removed.
--
-- Photos live in the existing public `member-avatars` bucket at
-- `${org}/profile-${id}.jpg`; its policies already let an org admin write any
-- object under their org's folder, so no storage change is needed.
--
-- Additive and re-runnable.

create table if not exists public.team_profiles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name       text not null check (char_length(btrim(full_name)) > 0),
  title           text,
  email           text,
  bio             text,
  avatar_url      text,
  created_by      uuid references public.principals(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.team_profiles is
  'Team members shown on Build > Team and in the data room who have no FundExecs login. Not a seat; not in organization_members.';

create index if not exists team_profiles_org_idx
  on public.team_profiles (organization_id, created_at);

-- One profile per email per org, so inviting by email can find exactly one to merge.
create unique index if not exists team_profiles_org_email_uidx
  on public.team_profiles (organization_id, lower(email))
  where email is not null;

alter table public.team_profiles enable row level security;

-- Every member of the org can read the roster.
drop policy if exists team_profiles_select on public.team_profiles;
create policy team_profiles_select on public.team_profiles
  for select using (organization_id in (select public.current_principal_org_ids()));

-- Only owners and admins manage it.
drop policy if exists team_profiles_insert on public.team_profiles;
create policy team_profiles_insert on public.team_profiles
  for insert with check (public.is_org_admin(organization_id));

drop policy if exists team_profiles_update on public.team_profiles;
create policy team_profiles_update on public.team_profiles
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists team_profiles_delete on public.team_profiles;
create policy team_profiles_delete on public.team_profiles
  for delete using (public.is_org_admin(organization_id));
