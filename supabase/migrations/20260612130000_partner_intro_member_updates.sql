-- =====================================================================
-- Partner intro requests (Source hub · Partners & providers): member
-- updates.
--
-- 20260608130000_partner_intro_requests.sql created the table with
-- members read + insert only (updates via service_role). The Partner
-- Network bench advances a relationship one stage at a time through the
-- approve loop — "Engage" moves the requester's own open intro request
-- (requested/accepted → introduced) — so the requester needs update on
-- their own rows. Additive + idempotent.
-- =====================================================================

grant update on table public.partner_intro_requests to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'partner_intro_requests'
      and policyname = 'members update own partner_intro_requests'
  ) then
    create policy "members update own partner_intro_requests"
      on public.partner_intro_requests
      for update to authenticated
      using (
        private.is_org_member(org_id)
        and requester_id = auth.uid()
      )
      with check (
        private.is_org_member(org_id)
        and requester_id = auth.uid()
      );
  end if;
end$$;
