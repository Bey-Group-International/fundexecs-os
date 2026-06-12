-- =====================================================================
-- Diligence (Run hub interior): finding resolutions.
--
-- The prototype's risk register lets the operator resolve a flagged or
-- cautioned workstream through the approve loop ("Update the diligence
-- record · Log evidence to Chain of Trust"). Findings are written by the
-- service-role orchestrator; the RESOLUTION is operator-driven, so active
-- members need update on their org's findings. Additive + idempotent.
-- =====================================================================

alter table public.diligence_findings
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution text;

grant update on table public.diligence_findings to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'diligence_findings'
      and policyname = 'members update own org diligence_findings'
  ) then
    create policy "members update own org diligence_findings"
      on public.diligence_findings
      for update to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = diligence_findings.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = diligence_findings.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;
end $$;
