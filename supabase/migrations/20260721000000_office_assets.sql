-- 20260721000000_office_assets.sql
-- Custom uploaded branding for the Virtual Office MapMaker.
--
-- Members can upload their own image props (logos, posters, wall art) and place
-- them on the office floor as `kind:"image"` objects (lib/office/layout.ts). The
-- uploaded PNGs are cached in a PUBLIC-read Storage bucket at
-- `${orgId}/${uuid}.png` and referenced by public URL from the object's `src`.
--
-- Mirrors the office-portraits bucket (20260720150000): public SELECT, and
-- write/replace/delete only under an org the caller belongs to. Unlike portraits
-- (which pin the filename to the caller's uid), any member of the org may manage
-- that org's shared branding, so the check is the org-folder prefix only.
--
-- Idempotent (`on conflict do nothing`, `drop policy if exists`) so a
-- preview-branch replay is a no-op.

-- ---------------------------------------------------------------------------
-- office-assets Storage bucket (public read)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('office-assets', 'office-assets', true)
on conflict (id) do nothing;

-- Storage RLS on storage.objects, scoped to this bucket. Public SELECT (the
-- bucket is public); a member may write/replace/delete ONLY objects whose first
-- path segment is one of the orgs they belong to.

-- SELECT — anyone may read office assets (public bucket).
drop policy if exists office_assets_select on storage.objects;
create policy office_assets_select on storage.objects
  for select using (bucket_id = 'office-assets');

-- INSERT — a member may only create objects under their own org's prefix.
drop policy if exists office_assets_insert on storage.objects;
create policy office_assets_insert on storage.objects
  for insert with check (
    bucket_id = 'office-assets'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
  );

-- UPDATE — a member may only replace objects under their own org's prefix.
drop policy if exists office_assets_update on storage.objects;
create policy office_assets_update on storage.objects
  for update using (
    bucket_id = 'office-assets'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
  )
  with check (
    bucket_id = 'office-assets'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
  );

-- DELETE — a member may only remove objects under their own org's prefix.
drop policy if exists office_assets_delete on storage.objects;
create policy office_assets_delete on storage.objects
  for delete using (
    bucket_id = 'office-assets'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
  );
