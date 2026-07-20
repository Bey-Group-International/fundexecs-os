-- 20260720150000_office_portrait.sql
-- Premium AI-generated portraits for Virtual Office members.
--
-- Each member can generate a portrait DERIVED from their avatar config
-- (lib/office/portraitPrompt.ts -> image provider). The rendered PNG is cached
-- in a PUBLIC-read Storage bucket at `${orgId}/${principalId}.png`, and its
-- public URL rides on the existing per-member row in `office_member_prefs`
-- (20260720130000) via a new `portrait_url` column.
--
-- Idempotent (`add column if not exists`, `on conflict do nothing`,
-- `drop policy if exists`) so a preview-branch replay is a no-op.

-- ---------------------------------------------------------------------------
-- portrait_url column on office_member_prefs
-- ---------------------------------------------------------------------------
-- No new table RLS: `office_member_prefs` already enables row level security
-- with a self-manage policy set (SELECT scoped to the member's org, INSERT/
-- UPDATE scoped to `principal_id = auth.uid()`). Those row-level policies
-- govern every column, so a member reading/writing their own `portrait_url` is
-- already covered.
alter table public.office_member_prefs
  add column if not exists portrait_url text;

comment on column public.office_member_prefs.portrait_url is
  'Public URL of the member''s cached AI portrait in the office-portraits Storage bucket; covered by the existing office_member_prefs self-manage RLS policies.';

-- ---------------------------------------------------------------------------
-- office-portraits Storage bucket (public read)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('office-portraits', 'office-portraits', true)
on conflict (id) do nothing;

-- Storage RLS on storage.objects, scoped to this bucket. Public SELECT (the
-- bucket is public); a principal may write/replace/delete ONLY objects under
-- their own `${orgId}/${principalId}` prefix — the first path segment must be
-- an org they belong to, and the filename must start with their own uid.

-- SELECT — anyone may read portraits (public bucket).
drop policy if exists office_portraits_select on storage.objects;
create policy office_portraits_select on storage.objects
  for select using (bucket_id = 'office-portraits');

-- INSERT — a member may only create their own portrait object.
drop policy if exists office_portraits_insert on storage.objects;
create policy office_portraits_insert on storage.objects
  for insert with check (
    bucket_id = 'office-portraits'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
    and split_part(name, '/', 2) like (auth.uid()::text || '.%')
  );

-- UPDATE — a member may only replace their own portrait object.
drop policy if exists office_portraits_update on storage.objects;
create policy office_portraits_update on storage.objects
  for update using (
    bucket_id = 'office-portraits'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
    and split_part(name, '/', 2) like (auth.uid()::text || '.%')
  )
  with check (
    bucket_id = 'office-portraits'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
    and split_part(name, '/', 2) like (auth.uid()::text || '.%')
  );

-- DELETE — a member may only remove their own portrait object.
drop policy if exists office_portraits_delete on storage.objects;
create policy office_portraits_delete on storage.objects
  for delete using (
    bucket_id = 'office-portraits'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
    and split_part(name, '/', 2) like (auth.uid()::text || '.%')
  );
