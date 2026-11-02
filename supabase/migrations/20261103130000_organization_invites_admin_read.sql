-- 20261103130000_organization_invites_admin_read.sql
-- Narrow who can read pending Team invites to organization owners and admins.
--
-- 20261103120000 let every member of an organization read its pending invites
-- (organization_members.current_principal_org_ids). A pending invite is just an
-- email address someone has been asked to bring in, and ordinary members and
-- viewers have no reason to see who an admin is inviting. Reading now needs
-- public.is_org_admin, the same test the Team page's invite form is behind.
--
-- Nothing in the application reads this table with a user session: every read
-- and write goes through the service role (lib/team-invites.server), which
-- bypasses RLS, so this changes what a signed-in member can query directly and
-- nothing else.

drop policy if exists organization_invites_select on public.organization_invites;
create policy organization_invites_select on public.organization_invites
  for select using (public.is_org_admin(organization_id));
