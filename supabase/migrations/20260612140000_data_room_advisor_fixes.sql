-- =====================================================================
-- Data-room advisor fixes (Supabase performance lints).
--
-- 1. `data_room_views` composite FK (link_id, org_id) had no covering
--    index — neither existing index leads with both columns.
-- 2. The member write policy on `data_room_links` re-evaluated
--    auth.uid() per row (auth_rls_initplan) and, as FOR ALL, stacked a
--    second permissive SELECT policy on top of the Wave-2 read policy
--    (multiple_permissive_policies). Recreate it as insert + update
--    policies (matching the table's grants — members never got DELETE)
--    with auth.uid() wrapped in a scalar subquery.
--
-- Additive + idempotent.
-- =====================================================================

create index if not exists data_room_views_link_org_idx
  on public.data_room_views (link_id, org_id);

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'data_room_links'
      and policyname = 'members write own org data room links'
  ) then
    drop policy "members write own org data room links"
      on public.data_room_links;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'data_room_links'
      and policyname = 'members insert own org data room links'
  ) then
    create policy "members insert own org data room links"
      on public.data_room_links
      for insert to authenticated
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = data_room_links.org_id
            and om.user_id = (select auth.uid())
            and om.status = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'data_room_links'
      and policyname = 'members update own org data room links'
  ) then
    create policy "members update own org data room links"
      on public.data_room_links
      for update to authenticated
      using (
        exists (
          select 1 from public.org_members om
          where om.org_id = data_room_links.org_id
            and om.user_id = (select auth.uid())
            and om.status = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.org_members om
          where om.org_id = data_room_links.org_id
            and om.user_id = (select auth.uid())
            and om.status = 'active'
        )
      );
  end if;
end$$;
