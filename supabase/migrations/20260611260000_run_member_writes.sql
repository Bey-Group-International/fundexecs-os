-- =====================================================================
-- Run interiors (Workflows / Compliance / IR): member writes.
--
-- 20260611102000_hub_run_interior.sql created the RUN tables with members
-- read-only (writes via service_role). The Run hub's interiors are
-- operator-driven through the approve loop — seeding the baselines and
-- advancing tasks/items happen in the UI — so active members need
-- insert/update on their org's rows. Additive + idempotent.
-- =====================================================================

grant insert, update on table public.workflows to authenticated;
grant insert, update on table public.workflow_tasks to authenticated;
grant insert, update on table public.automations to authenticated;
grant insert, update on table public.compliance_items to authenticated;
grant insert, update on table public.ir_items to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['workflows', 'workflow_tasks', 'automations',
                           'compliance_items', 'ir_items']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = 'members write own org ' || t
    ) then
      execute format($f$
        create policy %I on public.%I
          for all to authenticated
          using (
            exists (
              select 1 from public.org_members om
              where om.org_id = %I.org_id
                and om.user_id = auth.uid()
                and om.status = 'active'
            )
          )
          with check (
            exists (
              select 1 from public.org_members om
              where om.org_id = %I.org_id
                and om.user_id = auth.uid()
                and om.status = 'active'
            )
          )
      $f$, 'members write own org ' || t, t, t, t);
    end if;
  end loop;
end$$;
