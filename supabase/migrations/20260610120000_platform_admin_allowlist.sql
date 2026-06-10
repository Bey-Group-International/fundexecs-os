-- =====================================================================
-- Platform-admin allowlist (defense in depth for the Admin portal).
--
-- Until now ANY account on @beygroupintl.com was a platform admin. This
-- adds an explicit allowlist: the server gate (`requirePlatformAdmin`)
-- now requires the domain AND a row in `platform_admins`. Existing
-- domain accounts are grandfathered below so nobody who can use the
-- portal today is locked out by this deploy, and the documented team
-- mailboxes are seeded so they keep access when they first sign in.
--
-- Additive + idempotent.
-- =====================================================================

create table if not exists public.platform_admins (
  email text primary key,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint platform_admins_email_lowercase
    check (email = lower(btrim(email))),
  constraint platform_admins_email_domain
    check (email like '%@beygroupintl.com')
);

-- No RLS policies on purpose: only the service role and the SECURITY
-- DEFINER check below can read the table; nothing else writes it. Manage
-- rows via SQL until a portal surface exists:
--   insert into public.platform_admins (email)
--   values ('name@beygroupintl.com') on conflict (email) do nothing;
alter table public.platform_admins enable row level security;

-- Allowlist check for the SIGNED-IN caller. Reads the email off the
-- caller's own JWT (no email argument), so an authenticated user can only
-- ever probe their own membership — the list itself stays unreadable.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.email = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- Grandfather every existing Bey Group account so this deploy cannot lock
-- out a current platform admin…
insert into public.platform_admins (email)
select lower(u.email)
from auth.users u
where lower(u.email) like '%@beygroupintl.com'
on conflict (email) do nothing;

-- …and seed the documented team mailboxes (see lib/access.ts) so they are
-- enrolled even if they have not signed in yet.
insert into public.platform_admins (email)
values
  ('pres@beygroupintl.com'),
  ('vp@beygroupintl.com'),
  ('secretary@beygroupintl.com'),
  ('businessdevelopment@beygroupintl.com')
on conflict (email) do nothing;
