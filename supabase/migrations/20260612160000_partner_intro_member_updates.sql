-- =====================================================================
-- Partner intro requests (Source hub · Partners & providers): member
-- updates, scoped to the Engage transition only.
--
-- 20260608130000_partner_intro_requests.sql created the table with
-- members read + insert only (updates via service_role). The Partner
-- Network bench advances a relationship one stage at a time through the
-- approve loop — "Engage" moves the requester's own OPEN intro request
-- (requested/accepted → introduced). Members therefore need UPDATE on
-- their own rows, but ONLY to perform that one transition — not to
-- rewrite arbitrary fields/statuses.
--
-- The policy enforces the transition with USING + WITH CHECK:
--   USING       — only rows the member owns that are still open
--                 (status in requested/accepted) are updatable;
--   WITH CHECK  — the resulting row must land on 'introduced'.
-- So a member can advance an open request to introduced and nothing else
-- (no skipping Suggested→Engaged, no rewriting an introduced/declined row,
-- no flipping a row to an off-ladder status). Additive + idempotent.
-- =====================================================================

grant update on table public.partner_intro_requests to authenticated;

drop policy if exists "members update own partner_intro_requests"
  on public.partner_intro_requests;

create policy "members update own partner_intro_requests"
  on public.partner_intro_requests
  for update to authenticated
  using (
    private.is_org_member(org_id)
    and requester_id = auth.uid()
    and status in ('requested', 'accepted')
  )
  with check (
    private.is_org_member(org_id)
    and requester_id = auth.uid()
    and status = 'introduced'
  );
