-- P1-2 (safe subset): Revoke anon execute on trigger functions.
-- is_org_admin, is_org_writer, current_principal_org_ids are used in RLS policies
-- and cannot be revoked from anon without breaking authenticated queries.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_organization() FROM anon;
