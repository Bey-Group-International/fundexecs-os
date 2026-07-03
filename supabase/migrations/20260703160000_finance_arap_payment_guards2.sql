-- 20260703160000_finance_arap_payment_guards2.sql
-- Finance AR/AP — second review follow-up to PR #490.
--   Issue 1 (floor): the amount_paid <= total CHECK guarded the ceiling but not
--     the floor. A negative explicit allocation would drive amount_paid below
--     zero. Add CHECK (amount_paid >= 0) on fin_invoices AND CHECK (amount > 0)
--     on fin_payment_allocations — negative/zero allocations now abort at the DB
--     on either path (the explicit path updates the invoice before inserting, so
--     the amount_paid floor check fires first; the allocation check is a second
--     belt). Existing rows satisfy both, so the ADD CONSTRAINTs validate.
--   Minor: fin_cleanup_draft_invoices is scoped to an explicit org so a
--     multi-org caller (cron/admin) can never sweep every org's drafts.

do $$ begin
  alter table public.fin_invoices
    add constraint fin_invoices_amount_paid_nonneg check (amount_paid >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.fin_payment_allocations
    add constraint fin_payment_allocations_amount_pos check (amount > 0);
exception when duplicate_object then null; end $$;

-- Re-scope the draft-cleanup helper to a single organization (drop the old
-- single-arg version first — the signature changes).
drop function if exists public.fin_cleanup_draft_invoices(interval);
create or replace function public.fin_cleanup_draft_invoices(
  p_org uuid, p_older_than interval default interval '1 hour'
) returns integer
language plpgsql security invoker as $$
declare v_deleted integer;
begin
  with removed as (
    delete from public.fin_invoices
      where status = 'draft'
        and organization_id = p_org
        and created_at < now() - p_older_than
      returning 1
  )
  select count(*) into v_deleted from removed;
  return v_deleted;
end $$;
