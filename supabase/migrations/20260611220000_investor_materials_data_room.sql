-- =====================================================================
-- Materials & Data Room (Build hub interior).
--
-- 1. Widen capital_materials to carry the data-room flow's six investor
--    materials (DDQ, track record, financial model, LP update template
--    join the original four) and the operator's build spec as jsonb.
-- 2. Give data_room_links a human label (links can exist for generated
--    materials before any storage document does) and let active members
--    create/manage their org's links — Wave 2 granted members read-only,
--    but link generation is an operator action in the room UI.
--
-- Additive + idempotent (the kind check is widened, never narrowed).
-- =====================================================================

alter table public.capital_materials
  add column if not exists spec jsonb;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.capital_materials'::regclass
      and conname = 'capital_materials_kind_check'
  ) then
    alter table public.capital_materials
      drop constraint capital_materials_kind_check;
  end if;
  alter table public.capital_materials
    add constraint capital_materials_kind_check
    check (kind in (
      'pitch_deck', 'lp_one_pager', 'ic_memo', 'data_room_index',
      'ddq', 'track_record', 'financial_model', 'lp_update'
    ));
end$$;

alter table public.data_room_links
  add column if not exists label text;

grant insert, update on table public.data_room_links to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'data_room_links'
      and policyname = 'members write own org data room links'
  ) then
    create policy "members write own org data room links"
      on public.data_room_links
      for all to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = data_room_links.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = data_room_links.org_id
            and om.user_id = auth.uid()
            and om.status = 'active'
        )
      );
  end if;
end$$;
