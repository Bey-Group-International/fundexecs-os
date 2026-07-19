-- Drop the Virtual Office schema. The spatial-office feature (live floor,
-- program store, floor invites, and its approval enforcement) has been removed
-- from the product, so its backing tables are no longer used by any surface.
--
-- CASCADE clears the dependent indexes, RLS policies, and the
-- office_workflows updated-at trigger. The shared set_updated_at() function is
-- used by other tables and is intentionally left in place.
drop table if exists public.office_invite_tokens cascade;
drop table if exists public.office_audit_log cascade;
drop table if exists public.office_workflows cascade;
drop table if exists public.office_approvals cascade;
