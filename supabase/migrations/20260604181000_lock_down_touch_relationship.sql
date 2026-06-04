-- touch_relationship() is only invoked by the on_interaction trigger; it must
-- not be callable via the REST API. Revoke EXECUTE from all API roles.
revoke all on function public.touch_relationship() from public, anon, authenticated;
