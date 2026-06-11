-- =====================================================================
-- Closings (Execute hub interior): member writes.
--
-- 20260611101000_hub_data_room_execute.sql created `closings` and
-- `closing_steps` with members read-only (writes via service_role). The
-- Execute hub's Closings room is operator-driven — opening a closing and
-- executing its steps happen through the approve loop in the UI — so
-- active members need insert/update on their org's rows. Additive +
-- idempotent.
-- =====================================================================

grant insert, update on table public.closings to authenticated;
grant insert, update on table public.closing_steps to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'closings'
      and policyname = 'members write own org closings'
  ) then
    create policy "members write own org closings"
      on public.closings
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = closings.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = closings.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'closing_steps'
      and policyname = 'members write own org closing steps'
  ) then
    create policy "members write own org closing steps"
      on public.closing_steps
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = closing_steps.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = closing_steps.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;
end$$;
