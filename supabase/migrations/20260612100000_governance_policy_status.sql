-- =====================================================================
-- Governance policies: the Draft → Adopt stage progression.
--
-- The Structure & Governance hub shows each policy moving through
-- To do → Drafting → Active. `status` records where a policy sits:
-- 'drafted' (Earn produced the draft, awaiting adoption) or 'adopted'
-- (active across the firm). Existing rows default to 'adopted' — they
-- were all written by the adopt action. Additive + idempotent; RLS on
-- governance_policies (20260611210000) already covers member writes.
-- =====================================================================

alter table public.governance_policies
  add column if not exists status text not null default 'adopted';

-- A draft has not been adopted, so it carries no adoption timestamp. Relax the
-- inherited NOT NULL on adopted_at and tie its presence to status: adopted rows
-- keep a timestamp, drafted rows leave it null. Existing rows are all 'adopted'
-- with a timestamp set, so they satisfy the new constraint.
alter table public.governance_policies
  alter column adopted_at drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'governance_policies_status_check'
      and conrelid = 'public.governance_policies'::regclass
  ) then
    alter table public.governance_policies
      add constraint governance_policies_status_check
      check (status in ('drafted', 'adopted'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'governance_policies_adopted_at_check'
      and conrelid = 'public.governance_policies'::regclass
  ) then
    alter table public.governance_policies
      add constraint governance_policies_adopted_at_check
      check (
        (status = 'adopted' and adopted_at is not null)
        or (status = 'drafted' and adopted_at is null)
      );
  end if;
end$$;
