-- SOC 2 gap G-6: who can read an LP's session row.
--
-- A session row carries the LP's email and the link token. The token is the
-- credential in the investor's link (the emailed code is a second factor, but
-- the exposure was still wider than the review data, which is owners and
-- admins only). Until now:
--
--   * lp_onboarding_sessions_select let ANY member of the organization read
--     every row, token and email included, and
--   * lp_onboarding_sessions_write was `for all` for writers, which also
--     grants SELECT (permissive policies are OR-ed), and lets any member
--     change or delete a session directly.
--
-- Now every command on the table is owners and admins only. Members still get
-- the Execute > Closing board through a view that has the LP's name, stage and
-- commitment but no email and no token.
--
-- The application's own server actions for creating links and reviewing LPs
-- were already owner/admin only; the allocator invite
-- (createLpInviteAction) was the one exception and is now gated the same way
-- in code. Everything that runs as the service role (the LP's own pages,
-- reminders, the submit notice) bypasses row-level security and is unchanged.

drop policy if exists lp_onboarding_sessions_select on public.lp_onboarding_sessions;
drop policy if exists lp_onboarding_sessions_write on public.lp_onboarding_sessions;
drop policy if exists lp_onboarding_sessions_insert on public.lp_onboarding_sessions;
drop policy if exists lp_onboarding_sessions_update on public.lp_onboarding_sessions;
drop policy if exists lp_onboarding_sessions_delete on public.lp_onboarding_sessions;

create policy lp_onboarding_sessions_select on public.lp_onboarding_sessions
  for select using (public.is_org_admin(organization_id));

create policy lp_onboarding_sessions_insert on public.lp_onboarding_sessions
  for insert with check (public.is_org_admin(organization_id));

create policy lp_onboarding_sessions_update on public.lp_onboarding_sessions
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy lp_onboarding_sessions_delete on public.lp_onboarding_sessions
  for delete using (public.is_org_admin(organization_id));

-- What a member without admin rights may see of an LP session: no email, no
-- token. The view runs with its owner's rights (so it can read the table) and
-- applies the membership filter itself: current_principal_org_ids() is the
-- signed-in user's own organizations, and is empty for anyone not signed in.
create or replace view public.lp_onboarding_session_overview as
  select
    s.id,
    s.organization_id,
    s.lp_name,
    s.status,
    s.fund_id,
    s.commitment_amount,
    s.expires_at,
    s.created_at
  from public.lp_onboarding_sessions s
  where s.organization_id in (select public.current_principal_org_ids());

revoke all on public.lp_onboarding_session_overview from public;
revoke all on public.lp_onboarding_session_overview from anon;
grant select on public.lp_onboarding_session_overview to authenticated;
