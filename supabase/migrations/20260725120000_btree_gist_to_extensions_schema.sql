-- 20260725120000_btree_gist_to_extensions_schema.sql
-- Move btree_gist out of `public` into the `extensions` schema.
--
-- 20260724120000_scheduling_booking_overlap_guard created btree_gist without a
-- target schema, so it landed in `public` and Supabase's linter flags it
-- (0014_extension_in_public). Every other extension on this project —
-- pg_trgm, pgcrypto, uuid-ossp, vector, pg_stat_statements — already lives in
-- `extensions`, so this brings btree_gist in line with the project's own
-- convention rather than introducing a new one.
--
-- Existing indexes are unaffected: an index stores the OID of its operator
-- class, not a schema-qualified name, so scheduling_bookings_no_overlap keeps
-- working across the move. Only *new* GiST index definitions need the opclass
-- resolvable, and `extensions` is on the default search_path.
--
-- The earlier migration is deliberately left as written — it has already been
-- applied, and rewriting applied history is worse than moving forward.

do $$
begin
  -- A bare Postgres without Supabase's platform schema: leave well alone rather
  -- than inventing a schema the rest of the stack doesn't expect.
  if not exists (select 1 from pg_namespace where nspname = 'extensions') then
    raise notice 'btree_gist: no `extensions` schema on this database; leaving it in place.';
    return;
  end if;

  if exists (
    select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'btree_gist'
       and n.nspname <> 'extensions'
  ) then
    alter extension btree_gist set schema extensions;
  end if;
end $$;
