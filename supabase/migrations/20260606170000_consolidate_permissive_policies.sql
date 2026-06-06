-- Consolidate multiple permissive policies (database-linter 0006).
--
-- Each of these tables had an `ALL` (admin/owner) policy plus a broader `SELECT`
-- (member) policy. For the SELECT action that means two permissive policies are
-- evaluated per row. In every case the ALL policy's predicate is a strict subset
-- of the SELECT policy's for reads (an org admin is always a member; a row where
-- `user_id = auth.uid()` already satisfies the `OR` read predicate), so dropping
-- the ALL policy's SELECT coverage changes nothing for reads. We replace each
-- ALL policy with explicit INSERT / UPDATE / DELETE policies carrying the same
-- predicate, leaving exactly one policy per action.
--
-- auth.uid() stays wrapped in (select ...) to preserve the init-plan
-- optimisation from 20260606160000. Additive + idempotent.

------------------------------------------------------------------------------
-- brain_routing_rules
------------------------------------------------------------------------------
drop policy if exists "org admins manage brain_routing_rules" on public.brain_routing_rules;
drop policy if exists "admins insert brain_routing_rules" on public.brain_routing_rules;
drop policy if exists "admins update brain_routing_rules" on public.brain_routing_rules;
drop policy if exists "admins delete brain_routing_rules" on public.brain_routing_rules;

create policy "admins insert brain_routing_rules" on public.brain_routing_rules
  for insert to authenticated
  with check ((org_id is not null) and private.is_org_admin(org_id));
create policy "admins update brain_routing_rules" on public.brain_routing_rules
  for update to authenticated
  using ((org_id is not null) and private.is_org_admin(org_id))
  with check ((org_id is not null) and private.is_org_admin(org_id));
create policy "admins delete brain_routing_rules" on public.brain_routing_rules
  for delete to authenticated
  using ((org_id is not null) and private.is_org_admin(org_id));

------------------------------------------------------------------------------
-- integration_connections
------------------------------------------------------------------------------
drop policy if exists "manage own connections" on public.integration_connections;
drop policy if exists "insert own connections" on public.integration_connections;
drop policy if exists "update own connections" on public.integration_connections;
drop policy if exists "delete own connections" on public.integration_connections;

create policy "insert own connections" on public.integration_connections
  for insert to authenticated
  with check ((user_id = (select auth.uid())) and private.is_org_member(org_id));
create policy "update own connections" on public.integration_connections
  for update to authenticated
  using ((user_id = (select auth.uid())) and private.is_org_member(org_id))
  with check ((user_id = (select auth.uid())) and private.is_org_member(org_id));
create policy "delete own connections" on public.integration_connections
  for delete to authenticated
  using ((user_id = (select auth.uid())) and private.is_org_member(org_id));

------------------------------------------------------------------------------
-- org_members
------------------------------------------------------------------------------
drop policy if exists "admins manage members" on public.org_members;
drop policy if exists "admins insert members" on public.org_members;
drop policy if exists "admins update members" on public.org_members;
drop policy if exists "admins delete members" on public.org_members;

create policy "admins insert members" on public.org_members
  for insert to authenticated
  with check (private.is_org_admin(org_id));
create policy "admins update members" on public.org_members
  for update to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));
create policy "admins delete members" on public.org_members
  for delete to authenticated
  using (private.is_org_admin(org_id));

------------------------------------------------------------------------------
-- relationships
------------------------------------------------------------------------------
drop policy if exists "owner writes relationships" on public.relationships;
drop policy if exists "owner inserts relationships" on public.relationships;
drop policy if exists "owner updates relationships" on public.relationships;
drop policy if exists "owner deletes relationships" on public.relationships;

create policy "owner inserts relationships" on public.relationships
  for insert to authenticated
  with check ((user_id = (select auth.uid())) and private.is_org_member(org_id));
create policy "owner updates relationships" on public.relationships
  for update to authenticated
  using ((user_id = (select auth.uid())) and private.is_org_member(org_id))
  with check ((user_id = (select auth.uid())) and private.is_org_member(org_id));
create policy "owner deletes relationships" on public.relationships
  for delete to authenticated
  using ((user_id = (select auth.uid())) and private.is_org_member(org_id));
