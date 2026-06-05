-- =====================================================================
-- Patch: handle_new_user used 'investment' for organizations.type, which
-- is NOT a member of the org_type enum (fund | lp | operator |
-- capital_provider | service_provider | partner). Auth signups therefore
-- failed with "invalid input value for enum org_type".
--
-- Switch the auto-created org type to 'operator' (the most generic
-- workspace flavor — the user's true member_type is resolved later by
-- Proof of Truth + setMemberType). Additive + idempotent.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _bey uuid := 'b0000000-0000-4000-8000-000000000001';
  _email text := lower(coalesce(new.email, ''));
  _new_org uuid;
  _existing_org uuid;
  _org_name text;
begin
  -- 1) Always ensure a profile row.
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
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
