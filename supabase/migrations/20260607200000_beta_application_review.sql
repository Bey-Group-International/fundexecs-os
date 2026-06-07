-- =====================================================================
-- Beta application review — let admins triage the people who claimed a
-- shareable beta link from the AI-led /beta/claim welcome experience.
--
-- Claiming a link already auto-grants access (unchanged). These columns add an
-- OBSERVATIONAL review state on top of each claim so an admin can mark an
-- applicant pending → approved / rejected for their own follow-up. The status
-- does NOT gate access; it is a triage marker the Applications inbox renders and
-- the admin sets. Writes go through a service-role server action gated to the
-- Bey Group team, scoped by org_id.
-- =====================================================================

alter table public.beta_link_claims
  add column if not exists review_status text not null default 'pending',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null;

-- Constrain the status to the three known states. Guarded so re-running the
-- migration (or applying onto a branch that already has it) is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'beta_link_claims_review_status_check'
  ) then
    alter table public.beta_link_claims
      add constraint beta_link_claims_review_status_check
      check (review_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

-- The inbox lists newest-pending first within an org; this supports that scan.
create index if not exists beta_link_claims_org_review_idx
  on public.beta_link_claims (org_id, review_status, claimed_at desc);
