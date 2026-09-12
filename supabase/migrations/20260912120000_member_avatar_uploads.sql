-- 20260912120000_member_avatar_uploads.sql
-- Uploaded team photos (Build > Team) + member bios.
--
-- Before this migration a member's photo was whatever text sat in
-- `principals.avatar_url`: Build > Team offered a raw "Avatar image URL" box,
-- /settings stored a ~600KB base64 data URL, and the OAuth signup trigger
-- copied Google's remote CDN URL. The three disagreed -- a photo uploaded in
-- Settings rendered as initials on the team page, because that screen only
-- accepted http(s) URLs.
--
-- The column now holds exactly one thing: the public URL of an image this
-- platform stores, in the `member-avatars` bucket at `${orgId}/${principalId}.png`.
-- Everything else is cleared below.
--
-- Bucket RLS mirrors office-portraits (20260720150000), with one deliberate
-- widening: an owner/admin may also manage OTHER members' photos in their own
-- org, so a firm can put a face on a teammate who has not logged in yet.
--
-- Idempotent (`add column if not exists`, `on conflict do nothing`,
-- `drop policy if exists`) so a preview-branch replay is a no-op.

-- ---------------------------------------------------------------------------
-- bio column on principals
-- ---------------------------------------------------------------------------
-- The Build > Team header has always promised "members, roles, and bios" while
-- no bio field existed anywhere. No new table RLS: `principals` already enables
-- row level security, and its policies govern every column.
alter table public.principals
  add column if not exists bio text;

comment on column public.principals.bio is
  'Short member biography shown on Build > Team; covered by the existing principals RLS policies.';

-- ---------------------------------------------------------------------------
-- member-avatars Storage bucket (public read)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('member-avatars', 'member-avatars', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- current_principal_admin_org_ids -- orgs the caller owns or administers
-- ---------------------------------------------------------------------------
-- The set form of is_org_admin (0002_identity). The storage policies below
-- compare it against a path segment as TEXT rather than casting that segment to
-- uuid: the segment is attacker-controlled, and `'nonsense'::uuid` raises
-- 22P02 instead of evaluating to false. Same SECURITY DEFINER reasoning as
-- current_principal_org_ids -- a policy must be able to call it without
-- recursing into the organization_members policy.
create or replace function public.current_principal_admin_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where principal_id = auth.uid()
    and role in ('owner', 'admin');
$$;

-- Storage RLS on storage.objects, scoped to this bucket. Public SELECT (the
-- bucket is public); a principal may write/replace/delete an object only when
-- the first path segment is an org they belong to AND either the filename is
-- their own uid (their own photo) or they own/administer that org (managing a
-- teammate's photo).

-- SELECT -- anyone may read member photos (public bucket).
drop policy if exists member_avatars_select on storage.objects;
create policy member_avatars_select on storage.objects
  for select using (bucket_id = 'member-avatars');

-- INSERT -- own photo, or any member's photo when the caller is an org admin.
drop policy if exists member_avatars_insert on storage.objects;
create policy member_avatars_insert on storage.objects
  for insert with check (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
    and (
      split_part(name, '/', 2) like (auth.uid()::text || '.%')
      or (storage.foldername(name))[1] in (select public.current_principal_admin_org_ids()::text)
    )
  );

-- UPDATE -- same boundary as INSERT.
drop policy if exists member_avatars_update on storage.objects;
create policy member_avatars_update on storage.objects
  for update using (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
    and (
      split_part(name, '/', 2) like (auth.uid()::text || '.%')
      or (storage.foldername(name))[1] in (select public.current_principal_admin_org_ids()::text)
    )
  )
  with check (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
    and (
      split_part(name, '/', 2) like (auth.uid()::text || '.%')
      or (storage.foldername(name))[1] in (select public.current_principal_admin_org_ids()::text)
    )
  );

-- DELETE -- same boundary as INSERT.
drop policy if exists member_avatars_delete on storage.objects;
create policy member_avatars_delete on storage.objects
  for delete using (
    bucket_id = 'member-avatars'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
    and (
      split_part(name, '/', 2) like (auth.uid()::text || '.%')
      or (storage.foldername(name))[1] in (select public.current_principal_admin_org_ids()::text)
    )
  );

-- ---------------------------------------------------------------------------
-- Hard cut: clear every avatar_url this platform does not host
-- ---------------------------------------------------------------------------
-- The rendering path now accepts only `member-avatars` public URLs, so any
-- remaining value (a remote hotlink, a Google OAuth CDN URL, or a base64 data
-- URL written by the old /settings form) is dead weight that would never
-- render. Clearing it also reclaims the data URLs, which were up to ~600KB of
-- base64 on every row and rode along with every team, meetings, and people
-- query that selects avatar_url.
--
-- Members whose photo is cleared fall back to their initials until someone
-- uploads a real file -- the agreed trade for a single, trustworthy source.
update public.principals
   set avatar_url = null
 where avatar_url is not null
   and avatar_url not like '%/storage/v1/object/public/member-avatars/%';

-- ---------------------------------------------------------------------------
-- Stop the signup trigger from seeding a URL that can never render
-- ---------------------------------------------------------------------------
-- handle_new_user (0002_identity) copied `raw_user_meta_data ->> 'avatar_url'`,
-- which for a Google OAuth signup is a remote googleusercontent.com URL. Under
-- the uploads-only rule that value is unrenderable, so a brand-new Google user
-- would land with a photo set and initials on screen. Mirror name and email
-- only; the member uploads a photo in onboarding, /settings, or Build > Team.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.principals (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
