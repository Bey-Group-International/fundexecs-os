-- 20260912120000_document_uploads.sql
-- File upload for Documents › Library.
--
-- Until now a library document was either written inline (`content`) or a link
-- to a file living somewhere else (`storage_key` holding an http(s) URL, with
-- `mime_type` set to 'text/uri-list'). There was no way to put an actual file
-- into the product, which is the first thing an institutional operator tries to
-- do with a PPM, an audited financial, or a deck.
--
-- Files go into a PRIVATE bucket. Unlike office-assets/office-portraits (public
-- read, because an office prop is decoration), a fund's LPA is not world
-- readable by anyone who guesses a URL: every read is a short-lived signed URL
-- minted server-side, only after the caller has been checked — an org member on
-- the GP side, or a data-room token that has cleared the room manifest, the
-- link's section allowlist, and the share's gate.
--
-- Object layout is `${organization_id}/${document_id}/${uuid}.${ext}`:
--   • segment 1 is the org, which is what the Storage RLS policies key on;
--   • segment 2 is the document, so every version of one document shares a
--     prefix and deleting the document can remove all of its bytes in one call.
--
-- Idempotent (`on conflict`, `drop policy if exists`, `add column if not
-- exists`) so a preview-branch replay is a no-op.

-- ---------------------------------------------------------------------------
-- documents Storage bucket (private)
-- ---------------------------------------------------------------------------
-- 100 MB ceiling, enforced by Storage itself. This matters because uploads use
-- signed upload URLs: the browser PUTs straight to Storage, so the bucket limit
-- is the only thing standing between a mis-click and an unbounded object.
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 104857600)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- Writer-org helper for the Storage policies
-- ---------------------------------------------------------------------------
-- `current_principal_org_ids()` answers "which orgs am I in", which is the
-- right question for reading and the wrong one for writing: a viewer is in the
-- org but `documents_write` (0010_rls) will not let them touch the row. Without
-- a matching restriction on the bucket, a viewer could still push bytes into
-- the org's prefix — orphaned, unattachable, but there.
--
-- SECURITY DEFINER for the same reason current_principal_org_ids() is: a policy
-- that selects from organization_members under the caller's own RLS recurses.
create or replace function public.current_principal_writer_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where principal_id = auth.uid()
    and role in ('owner', 'admin', 'member');
$$;

-- Storage RLS on storage.objects, scoped to this bucket. Every verb — SELECT
-- included, since the bucket is private — requires the object's first path
-- segment to be an org the caller belongs to; writes additionally require the
-- caller to be a writer in that org, mirroring `documents_write`.

-- SELECT — any member of the owning org may read.
drop policy if exists documents_bucket_select on storage.objects;
create policy documents_bucket_select on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select public.current_principal_org_ids()::text)
  );

-- INSERT — a writer may only create objects under their own org's prefix.
drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select public.current_principal_writer_org_ids()::text)
  );

-- UPDATE — a writer may only replace objects under their own org's prefix.
drop policy if exists documents_bucket_update on storage.objects;
create policy documents_bucket_update on storage.objects
  for update using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select public.current_principal_writer_org_ids()::text)
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select public.current_principal_writer_org_ids()::text)
  );

-- DELETE — a writer may only remove objects under their own org's prefix.
drop policy if exists documents_bucket_delete on storage.objects;
create policy documents_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select public.current_principal_writer_org_ids()::text)
  );

-- ---------------------------------------------------------------------------
-- documents.updated_at — the Library table sorts and reports on it
-- ---------------------------------------------------------------------------
-- `documents` has only ever carried created_at, so the library could not answer
-- "what changed recently" — the first question asked of a room being readied.
alter table public.documents
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_documents_updated_at on public.documents;
create trigger trg_documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- document_versions — cover uploaded files, not just inline content
-- ---------------------------------------------------------------------------
-- Replacing a file is a new version of the same document, exactly as saving
-- inline content is. The snapshot therefore has to carry the file identity too,
-- otherwise restoring a version would restore the old NAME onto the new FILE.
--
-- The snapshot keeps its own storage_key and the object it points at is left in
-- place, so a restore is a pointer swap rather than a re-upload. The 20-version
-- prune trigger drops those rows; their objects stay under the document's
-- prefix until the document is deleted, which removes the prefix wholesale.
alter table public.document_versions
  add column if not exists storage_key text,
  add column if not exists mime_type   text,
  add column if not exists size_bytes  bigint;

-- ---------------------------------------------------------------------------
-- Library read path
-- ---------------------------------------------------------------------------
-- The library groups by section within an org on every render.
create index if not exists documents_org_type_idx
  on public.documents (organization_id, doc_type);
