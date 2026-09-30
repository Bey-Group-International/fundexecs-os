-- The index the corrected-entry filter reads through.
--
-- The timeline reads a contact's entries newest-first and now has to skip the
-- ones marked misattributed (20260930100000), so the predicate belongs in the
-- index rather than making every read filter a column it cannot use one for.
--
-- IN ITS OWN MIGRATION on purpose. 20260930100000 adds a foreign key, which
-- takes SHARE ROW EXCLUSIVE on network_activities and on principals; NOT VALID
-- avoids the row scan but not those locks, and Postgres holds them until the
-- transaction ends. Building this index in that same transaction would keep both
-- tables locked against writes for the build's duration too. Split, the
-- constraint's locks release when its migration commits and this one blocks only
-- network_activities.
--
-- DEPLOYMENT NOTE. This build still blocks writes to network_activities while it
-- runs (reads continue). CREATE INDEX CONCURRENTLY is not available: it cannot
-- run inside a transaction block, every migration in this repo runs in one, and
-- no migration here uses it. So check the row count and pick a low-traffic
-- window, as for the generated columns in 20260930083000 and 20260930090000.

create index if not exists network_activities_contact_visible_idx
  on public.network_activities (organization_id, contact_id, occurred_at desc)
  where misattributed_at is null;
