-- =====================================================================
-- Harden SECURITY DEFINER helpers: relocate the RLS policy helpers out of
-- the API-exposed `public` schema into a non-exposed `private` schema
-- (PostgREST only exposes `public`), and pin search_path on the trigger fn.
-- =====================================================================

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------- recreate helpers in private ----------
create or replace function private.is_org_member(_org_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = auth.uid()
  );
$$;

create or replace function private.is_org_admin(_org_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function private.shares_org(_user_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1
    from public.org_members a
    join public.org_members b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = _user_id
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.is_org_admin(uuid) from public, anon;
revoke all on function private.shares_org(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_admin(uuid) to authenticated;
grant execute on function private.shares_org(uuid) to authenticated;

-- ---------- repoint all policies to the private helpers ----------
-- organizations
drop policy "members view their orgs" on public.organizations;
create policy "members view their orgs" on public.organizations
  for select to authenticated using (private.is_org_member(id));
drop policy "admins update their org" on public.organizations;
create policy "admins update their org" on public.organizations
  for update to authenticated using (private.is_org_admin(id)) with check (private.is_org_admin(id));
drop policy "owners delete their org" on public.organizations;
create policy "owners delete their org" on public.organizations
  for delete to authenticated using (private.is_org_admin(id));

-- profiles
drop policy "view own or co-member profiles" on public.profiles;
create policy "view own or co-member profiles" on public.profiles
  for select to authenticated using (id = auth.uid() or private.shares_org(id));

-- org_members
drop policy "members view co-members" on public.org_members;
create policy "members view co-members" on public.org_members
  for select to authenticated using (private.is_org_member(org_id));
drop policy "admins manage members" on public.org_members;
create policy "admins manage members" on public.org_members
  for all to authenticated using (private.is_org_admin(org_id)) with check (private.is_org_admin(org_id));

-- deals
drop policy "members read deals" on public.deals;
create policy "members read deals" on public.deals
  for select to authenticated using (private.is_org_member(org_id));
drop policy "members insert deals" on public.deals;
create policy "members insert deals" on public.deals
  for insert to authenticated with check (private.is_org_member(org_id));
drop policy "members update deals" on public.deals;
create policy "members update deals" on public.deals
  for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
drop policy "admins delete deals" on public.deals;
create policy "admins delete deals" on public.deals
  for delete to authenticated using (private.is_org_admin(org_id));

-- allocations
drop policy "members read allocations" on public.allocations;
create policy "members read allocations" on public.allocations
  for select to authenticated using (private.is_org_member(org_id));
drop policy "members insert allocations" on public.allocations;
create policy "members insert allocations" on public.allocations
  for insert to authenticated with check (private.is_org_member(org_id));
drop policy "members update allocations" on public.allocations;
create policy "members update allocations" on public.allocations
  for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
drop policy "admins delete allocations" on public.allocations;
create policy "admins delete allocations" on public.allocations
  for delete to authenticated using (private.is_org_admin(org_id));

-- partnerships
drop policy "members read partnerships" on public.partnerships;
create policy "members read partnerships" on public.partnerships
  for select to authenticated using (private.is_org_member(org_id));
drop policy "members insert partnerships" on public.partnerships;
create policy "members insert partnerships" on public.partnerships
  for insert to authenticated with check (private.is_org_member(org_id));
drop policy "members update partnerships" on public.partnerships;
create policy "members update partnerships" on public.partnerships
  for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
drop policy "admins delete partnerships" on public.partnerships;
create policy "admins delete partnerships" on public.partnerships
  for delete to authenticated using (private.is_org_admin(org_id));

-- tasks
drop policy "members read tasks" on public.tasks;
create policy "members read tasks" on public.tasks
  for select to authenticated using (private.is_org_member(org_id));
drop policy "members insert tasks" on public.tasks;
create policy "members insert tasks" on public.tasks
  for insert to authenticated with check (private.is_org_member(org_id));
drop policy "members update tasks" on public.tasks;
create policy "members update tasks" on public.tasks
  for update to authenticated using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
drop policy "admins delete tasks" on public.tasks;
create policy "admins delete tasks" on public.tasks
  for delete to authenticated using (private.is_org_admin(org_id));

-- trust_events
drop policy "members read trust_events" on public.trust_events;
create policy "members read trust_events" on public.trust_events
  for select to authenticated using (private.is_org_member(org_id));
drop policy "members append trust_events" on public.trust_events;
create policy "members append trust_events" on public.trust_events
  for insert to authenticated with check (private.is_org_member(org_id));

-- ---------- drop the now-unused public helpers ----------
drop function public.is_org_member(uuid);
drop function public.is_org_admin(uuid);
drop function public.shares_org(uuid);

-- ---------- pin search_path on the updated_at trigger function ----------
alter function public.set_updated_at() set search_path = '';

-- ---------- the new-user trigger fn is only invoked by the trigger ----------
revoke all on function public.handle_new_user() from public, anon, authenticated;
