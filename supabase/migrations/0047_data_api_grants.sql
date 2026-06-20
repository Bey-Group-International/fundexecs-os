-- 0047_data_api_grants.sql
-- Restore the legacy Supabase Data API grants.
--
-- Every migration in this repo was authored under Supabase's legacy behavior of
-- auto-granting Data API privileges (SELECT/INSERT/UPDATE/DELETE on new `public`
-- tables, EXECUTE on functions, USAGE/SELECT on sequences) to the `anon`,
-- `authenticated`, and `service_role` roles. None of them carry explicit grants
-- because they never had to.
--
-- Supabase is moving the platform default to *revoke* those automatic grants so
-- exposure becomes opt-in (https://github.com/orgs/supabase/discussions/45329).
-- Under the new default, every Data API call fails with `permission denied for
-- table ...` (42501) and onboarding (creating an organization) breaks on the
-- first request. (The actual row-level security boundary lives in 0010_rls.sql
-- and friends; these grants only control whether a role can reach an object at
-- all over the Data API — RLS still governs which rows it sees.)
--
-- The fix is the documented one: grant the privileges explicitly on the objects
-- that exist today, and set default privileges so future migrations keep the
-- legacy behavior without per-table grants. This is the SQL equivalent of the
-- old auto-expose default, expressed in a migration so it replays identically on
-- local stacks, preview branches, and production.

-- ---------------------------------------------------------------------------
-- Existing objects
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

grant execute on all functions in schema public
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Future objects — mirror the legacy auto-grant default so later migrations
-- (and `create table` run as the `postgres` role) stay reachable without
-- repeating these grants.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
