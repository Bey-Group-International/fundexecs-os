-- =====================================================================
-- Atomic first-run onboarding identity/workspace setup.
-- Keeps org creation, owner membership, and profile identity in one
-- transaction so retries and double-clicks cannot create split onboarding
-- state.
-- =====================================================================

create or replace function public.save_onboarding_identity(
  _full_name text default null,
  _role text default null,
  _org_name text default null,
  _org_type public.org_type default 'fund'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _user_id uuid := auth.uid();
  _org_id uuid;
  _clean_full_name text := nullif(left(btrim(coalesce(_full_name, '')), 120), '');
  _clean_role text := nullif(left(btrim(coalesce(_role, '')), 80), '');
  _clean_org_name text := nullif(left(btrim(coalesce(_org_name, '')), 120), '');
begin
  if _user_id is null then
    raise exception 'must be authenticated to save onboarding identity';
  end if;

  -- Serialize first-workspace creation per user while keeping this function
  -- lightweight. The two-int advisory lock form is scoped to this transaction.
  perform pg_advisory_xact_lock(hashtext('save_onboarding_identity'), hashtext(_user_id::text));

  if _clean_role is null or _clean_role not in (
    'managing_partner',
    'principal',
    'operator',
    'limited_partner',
    'capital_provider',
    'advisor'
  ) then
    _clean_role := 'managing_partner';
  end if;

  select m.org_id
    into _org_id
  from public.org_members m
  where m.user_id = _user_id
    and m.status = 'active'
  order by m.created_at asc
  limit 1;

  if _org_id is null then
    if _clean_org_name is null then
      raise exception 'organization name is required to create your workspace';
    end if;

    insert into public.organizations (name, type)
    values (_clean_org_name, coalesce(_org_type, 'fund'::public.org_type))
    returning id into _org_id;

    insert into public.org_members (org_id, user_id, role, status)
    values (_org_id, _user_id, 'owner', 'active')
    on conflict (org_id, user_id) do nothing;
  end if;

  update public.profiles
  set
    full_name = coalesce(_clean_full_name, full_name),
    role = coalesce(_clean_role, role)
  where id = _user_id;

  if not found then
    insert into public.profiles (id, full_name, role)
    values (_user_id, coalesce(_clean_full_name, ''), _clean_role)
    on conflict (id) do update
    set
      full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
      role = coalesce(excluded.role, public.profiles.role);
  end if;

  return _org_id;
end;
$$;

revoke all on function public.save_onboarding_identity(text, text, text, public.org_type) from public, anon;
grant execute on function public.save_onboarding_identity(text, text, text, public.org_type) to authenticated;
