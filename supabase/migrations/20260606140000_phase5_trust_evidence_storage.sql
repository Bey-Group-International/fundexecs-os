-- =====================================================================
-- Phase 5 — Chain of Trust end-to-end persistence (§3C).
-- Additive + idempotent. Adds:
--   1. Missing columns on `public.evidence` (mime_type, size_bytes,
--      ai validation timestamps, approval workflow, rejection reason).
--   2. The private `trust-evidence` Storage bucket.
--   3. RLS on `storage.objects` for that bucket only — org-membership
--      gated SELECT/INSERT, denied UPDATE, scoped DELETE.
-- =====================================================================

-- 1. evidence: workflow columns ---------------------------------------
alter table public.evidence
  add column if not exists mime_type text,
  add column if not exists size_bytes integer,
  add column if not exists file_name text,
  add column if not exists ai_validation_notes text,
  add column if not exists ai_validated_at timestamp with time zone,
  add column if not exists uploaded_at timestamp with time zone,
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamp with time zone,
  add column if not exists rejection_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'evidence_approval_status_check') then
    alter table public.evidence
      add constraint evidence_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'evidence_approved_by_fkey'
  ) then
    alter table public.evidence
      add constraint evidence_approved_by_fkey
      foreign key (approved_by) references public.profiles(id) on delete set null;
  end if;
end$$;

create index if not exists evidence_status_idx
  on public.evidence (proof_layer_id, approval_status);

-- Members already have INSERT/SELECT/DELETE policies. Add an UPDATE policy
-- so approvers can flip approval_status (the existing core RLS only had
-- read + admin-delete + member-insert — no update path).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'evidence' and policyname = 'members update evidence'
  ) then
    create policy "members update evidence" on public.evidence
      for update to authenticated
      using (private.is_org_member(org_id))
      with check (private.is_org_member(org_id));
  end if;
end$$;

-- 2. Storage bucket ---------------------------------------------------
insert into storage.buckets (id, name, public)
values ('trust-evidence', 'trust-evidence', false)
on conflict (id) do nothing;

-- 3. RLS on storage.objects for the trust-evidence bucket only --------
-- Path convention: {org_id}/{record_id}/{evidence_id}/{filename}
-- The first segment is the org_id we authorise against.
--
-- Helper inline: split the path on '/' and read the first segment.
-- `storage.foldername(name)` returns the path components as text[].

drop policy if exists "trust_evidence members read" on storage.objects;
create policy "trust_evidence members read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'trust-evidence'
    and (
      (storage.foldername(name))[1]::uuid in (
        select om.org_id from public.org_members om
        where om.user_id = auth.uid() and om.status = 'active'
      )
    )
  );

drop policy if exists "trust_evidence members upload" on storage.objects;
create policy "trust_evidence members upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'trust-evidence'
    and (
      (storage.foldername(name))[1]::uuid in (
        select om.org_id from public.org_members om
        where om.user_id = auth.uid() and om.status = 'active'
      )
    )
    -- Mime allowlist enforced here (server-side validation in the
    -- action layer is the primary gate; this is defense in depth).
    and coalesce(
      (metadata ->> 'mimetype'),
      (metadata ->> 'contentType'),
      ''
    ) in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/json',
      'text/plain',
      'text/csv',
      'text/markdown',
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      ''  -- empty string: signed-URL uploads pre-supabase v2.46 do not always carry mimetype in metadata; the action layer's pre-insert validation is the binding check.
    )
  );

-- No UPDATE policy on storage.objects for this bucket: evidence is
-- append-only at the storage layer. To replace evidence, upload a new
-- object + insert a new evidence row + revoke the old one.
drop policy if exists "trust_evidence deny update" on storage.objects;

drop policy if exists "trust_evidence uploader delete" on storage.objects;
create policy "trust_evidence uploader delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'trust-evidence'
    and owner = auth.uid()
    and exists (
      select 1 from public.evidence e
      where e.storage_path = name
        and e.approval_status in ('pending', 'rejected')
    )
  );

-- =====================================================================
-- Storage bucket file-size cap. Supabase enforces this at the bucket
-- level — set to 25 MB.
-- =====================================================================
update storage.buckets
   set file_size_limit = 25 * 1024 * 1024
 where id = 'trust-evidence';
