-- ============================================================================
-- Accredited-investor verification for raise reservations (beyond self-attestation).
--
-- 506(c) requires the issuer to take "reasonable steps to verify" accredited
-- status — a self-attestation checkbox alone is not sufficient. This adds a
-- verification workflow on raise_interests: the investor declares a verification
-- METHOD (and optional evidence note/link) when reserving, landing in 'pending';
-- an org owner/admin then reviews and marks it 'verified' or 'rejected'.
--
-- Additive + idempotent. Adds an owner/admin UPDATE policy so reviewers can set
-- the verification decision (public writes remain service-role only).
-- ============================================================================

alter table public.raise_interests
  add column if not exists verification_status text not null default 'unverified';
alter table public.raise_interests
  add column if not exists verification_method text;
-- Investor-provided evidence reference: a note or link (e.g. a third-party
-- verification letter URL). File-upload-to-storage is a later step.
alter table public.raise_interests
  add column if not exists verification_evidence text;
alter table public.raise_interests
  add column if not exists verified_at timestamptz;
alter table public.raise_interests
  add column if not exists verified_by uuid references public.profiles (id) on delete set null;
alter table public.raise_interests
  add column if not exists reviewer_note text;

alter table public.raise_interests
  drop constraint if exists raise_interests_verification_status_chk;
alter table public.raise_interests
  add constraint raise_interests_verification_status_chk
  check (verification_status in ('unverified', 'pending', 'verified', 'rejected'));

-- Owners/admins review verification → they need UPDATE (public writes stay on the
-- service-role admin client; this policy only governs authenticated reviewers).
grant update on table public.raise_interests to authenticated;

drop policy if exists "owners update raise interests" on public.raise_interests;
create policy "owners update raise interests" on public.raise_interests
  for update to authenticated
  using (private.is_org_admin(org_id))
  with check (private.is_org_admin(org_id));
