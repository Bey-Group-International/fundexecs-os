-- Anonymous callers can no longer execute SECURITY DEFINER functions they have
-- no use for, and new functions stop being anonymously executable by default.
--
-- Why this exists: Supabase's default privileges grant EXECUTE on every
-- function created in `public` by the postgres role to anon, authenticated and
-- service_role. `revoke ... from public` does not remove those direct grants,
-- so every SECURITY DEFINER function written since has been callable with the
-- anon key that ships in the browser bundle. 20261024120000 closed the credit
-- and reputation functions; this closes the rest, then stops the pattern.
--
-- What changes, by group (the audit behind it is in the PR description):
--
-- 1. anon loses EXECUTE on functions the app only calls as a signed-in user or
--    the service role. authenticated and service_role keep it.
--    - increment_calendar_feed_failures / increment_google_calendar_failures
--      treat `auth.uid() IS NULL` as the cron job. An anonymous request has a
--      null uid too, so anyone could run up the failure count on any feed or
--      connection whose id they knew. With anon revoked, a null uid can only
--      be the service role, which is what the check assumed.
--    - network_opportunity_refs_ok is an existence check ("is this investor,
--      fund or commitment in that org?") with no caller check, so it was a
--      cross-tenant oracle for anonymous callers.
--    - the rest check auth.uid() themselves and already reject anonymous
--      callers; the grant is just not needed.
--
-- 2. The three follow-up recount functions are only ever called by triggers
--    and by each other (both run as the function owner, who needs no grant).
--    They take any meeting or task id and have no caller check, so they are
--    closed to anon AND authenticated. service_role keeps them.
--
-- 3. Trigger functions cannot be called directly, and Postgres checks EXECUTE
--    on a trigger function only when the trigger is created, not when it
--    fires. Revoking is hygiene and does not affect any existing trigger.
--
-- 4. Default privileges: functions the postgres role creates in `public` are
--    no longer granted to anon. A function that really must be anonymously
--    callable needs an explicit, reviewed GRANT.
--
-- Deliberately NOT touched: current_principal_org_ids,
-- current_principal_admin_org_ids, current_principal_writer_org_ids,
-- is_org_admin, is_org_writer, is_live_meeting_host and attended_live_meeting.
-- They return nothing for a null uid, but RLS policies that apply to anon
-- (about 150 tables) and storage policies call them. Revoking them would turn
-- "no rows" into "permission denied" for anonymous requests.
--
-- Looked up by name rather than written out by signature, so a changed
-- argument list cannot make this fail, and a function that does not exist is
-- skipped. Idempotent: REVOKE of a privilege that is not held is a no-op.

do $$
declare
  fn regprocedure;
begin
  -- 1. Keep authenticated + service_role, drop anon.
  for fn in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname = any (array[
         'flag_network_activity_misattributed',
         'increment_calendar_feed_failures',
         'increment_google_calendar_failures',
         'merge_network_contacts',
         'network_automation_claim_run',
         'network_automation_record_run',
         'network_automation_run_finish',
         'network_contact_visible',
         'network_opportunity_refs_ok',
         'office_role_can_approve'
       ])
  loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;

  -- 2. Trigger-internal helpers: service_role only.
  for fn in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname = any (array[
         'live_meeting_recount_replies',
         'live_meeting_sync_followup',
         'sync_meeting_followup_for_task'
       ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  -- 3. Trigger functions: nobody calls these through the API.
  for fn in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname = any (array[
         'approvals_sync_meeting_followup',
         'audit_table_change',
         'handle_new_organization',
         'handle_new_user',
         'inbox_messages_track_inbound',
         'inbox_threads_recount_meeting',
         'network_contact_backfill_links',
         'network_contact_touch_activity',
         'prune_document_versions',
         'tasks_sync_meeting_followup'
       ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;

-- 4. New functions stop being anonymously executable by default.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
