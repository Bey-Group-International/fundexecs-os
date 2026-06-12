-- =====================================================================
-- Beta access approval — the real, ENFORCED gate.
--
-- The private beta keeps the door open (anyone can sign up and brief their
-- team, so we capture the account + mandate data), but full app entry is now
-- gated on an admin decision. `member_profiles.access_status` records that
-- decision:
--   'pending'  → signed up + may onboard, held at /pending until approved
--   'approved' → may enter the command center (the prior, ungated behavior)
--   'rejected' → declined; held at /pending with a declined message
--
-- The middleware reads this column alongside `status` (onboarding complete).
-- Decisions are written by a platform-admin server action (service role),
-- audited in `admin_actions`. This is additive + idempotent; no destructive
-- DDL. Existing members are backfilled to 'approved' so the gate never
-- retroactively locks out anyone already in the beta.
-- =====================================================================

-- Decision metadata — additive, data-free, safe to (re-)add any time.
alter table public.member_profiles
  add column if not exists access_decided_at timestamptz,
  add column if not exists access_decided_by uuid references public.profiles (id) on delete set null;

-- The gate column + its ONE-TIME backfill, run together only when the column
-- is first created. Tying the backfill to column creation keeps it strictly
-- one-shot: on a re-run the column already exists, so neither the add nor the
-- approve-everyone backfill fires again — a genuine new 'pending' applicant is
-- never retroactively approved.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_profiles'
      and column_name = 'access_status'
  ) then
    alter table public.member_profiles
      add column access_status text not null default 'pending';

    -- Everyone who already had a profile was ungated before the gate shipped —
    -- keep their access. New sign-ups insert with the 'pending' default.
    update public.member_profiles
      set access_status = 'approved',
          access_decided_at = coalesce(access_decided_at, now());
  end if;
end $$;

-- Constrain to the three known states. Guarded so re-running is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'member_profiles_access_status_check'
      and conrelid = 'public.member_profiles'::regclass
  ) then
    alter table public.member_profiles
      add constraint member_profiles_access_status_check
      check (access_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

-- The Applications inbox scans pending-first; this supports that worklist scan.
create index if not exists member_profiles_access_status_idx
  on public.member_profiles (access_status, updated_at desc);
