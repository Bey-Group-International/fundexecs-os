-- =====================================================================
-- Profile avatar photos.
--
-- Adds `profiles.avatar_url` so the shell can show a real photo (Google
-- sign-in picture or an uploaded image) instead of initials, with initials
-- as the graceful fallback when it's null.
--
--   1. Add the column (idempotent).
--   2. Backfill existing users from their Google OAuth metadata
--      (raw_user_meta_data.avatar_url / .picture).
--   3. Extend handle_new_user so new signups capture the photo at creation.
--
-- The Settings avatar uploader writes to this same column via a server action.
-- Additive + idempotent.
-- =====================================================================

alter table public.profiles add column if not exists avatar_url text;

-- Backfill existing rows from the Google OAuth metadata captured at signup.
update public.profiles p
set avatar_url = nullif(
  coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
  ''
)
from auth.users u
where u.id = p.id
  and p.avatar_url is null
  and coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') is not null;

-- Recreate handle_new_user (verbatim from 20260606123000, plus avatar_url
-- capture in the profile insert) so new signups land with their photo.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _bey uuid := 'b0000000-0000-4000-8000-000000000001';
  _email text := lower(coalesce(new.email, ''));
  _new_org uuid;
  _existing_org uuid;
  _org_name text;
begin
  -- 1) Always ensure a profile row (capturing the OAuth photo when present).
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'), '')
  )
  on conflict (id) do nothing;

  -- 2) Bey back-compat: @beygroupintl.com still lands in the shared Bey org as
  --    admin, with the rich Bey demo seed. Existing behaviour preserved so we
  --    do not double-seed legacy users.
  if _email like '%@beygroupintl.com' then
    update public.profiles set role = 'admin' where id = new.id;
    insert into public.org_members (org_id, user_id, role)
    values (_bey, new.id, 'admin')
    on conflict (org_id, user_id) do nothing;

    if not exists (select 1 from public.interactions where user_id = new.id) then
      perform public.seed_demo_for_user(_bey, new.id);
    end if;

    return new;
  end if;

  -- 3) Everyone else: auto-create an org + baseline seed.
  select om.org_id into _existing_org
    from public.org_members om
   where om.user_id = new.id
   order by om.created_at asc
   limit 1;

  if _existing_org is null then
    _org_name := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'org_name'), ''),
      nullif(split_part(_email, '@', 1), '') || ' Workspace',
      'Your workspace'
    );

    insert into public.organizations (name, type)
    values (_org_name, 'operator'::public.org_type)
    returning id into _new_org;

    insert into public.org_members (org_id, user_id, role)
    values (_new_org, new.id, 'owner')
    on conflict (org_id, user_id) do nothing;
  else
    _new_org := _existing_org;
  end if;

  -- 4) Baseline seed (idempotent — re-runs are no-ops).
  perform public.seed_demo_baseline_for_org(_new_org, new.id);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
