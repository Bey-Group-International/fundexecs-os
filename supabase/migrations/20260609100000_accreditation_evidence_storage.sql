-- ============================================================================
-- Accreditation-evidence Storage for 506(c) raise reservations.
--
-- Investors upload a document (PDF / image) when reserving on a 506(c) raise.
-- Because the uploader is UNAUTHENTICATED, uploads happen via service-role
-- signed upload URLs (generated server-side). Owner/admin downloads are served
-- via service-role signed download URLs after an RLS authorization check in the
-- action layer. There is therefore NO INSERT policy on storage.objects for this
-- bucket — only a SELECT policy for authenticated org members.
--
-- Additive + idempotent.
-- ============================================================================

-- 1. Add document-path column to raise_interests --------------------------
alter table public.raise_interests
  add column if not exists verification_document_path text;

-- 2. Private storage bucket -----------------------------------------------
insert into storage.buckets (id, name, public)
values ('accreditation-evidence', 'accreditation-evidence', false)
on conflict (id) do nothing;

-- Cap uploads at 15 MB (stricter than trust-evidence's 25 MB since these
-- are investor-facing self-service uploads, not org-managed evidence files).
update storage.buckets
   set file_size_limit = 15 * 1024 * 1024
 where id = 'accreditation-evidence';

-- 3. RLS on storage.objects — SELECT only, keyed on org membership ---------
-- Path convention: {org_id}/{uuid}/{filename}
-- The first path segment is the org_id we authorise against.
-- Mirrors the trust-evidence "members read" pattern exactly.
-- No INSERT/UPDATE policies: uploads go through service-role signed URLs;
-- this SELECT policy gates authenticated owner/admin download URL requests.

drop policy if exists "accreditation_evidence members read" on storage.objects;
create policy "accreditation_evidence members read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'accreditation-evidence'
    and (
      (storage.foldername(name))[1]::uuid in (
        select om.org_id from public.org_members om
        where om.user_id = auth.uid() and om.status = 'active'
      )
    )
  );
