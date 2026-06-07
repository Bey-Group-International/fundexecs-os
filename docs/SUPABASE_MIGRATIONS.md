# Supabase migrations — production deployment

Production (`emityvdaeiqxtpxdhyky`) is wired to this repo through Supabase's
GitHub integration on the `main` branch. On every push to `main`, Supabase
runs `supabase db push`, which applies any migration files in
`supabase/migrations/` that aren't yet recorded in the project's
`supabase_migrations.schema_migrations` table.

## The rule

**Apply production schema changes by merging a migration file to `main`.**
Let the integration apply it. Do **not** hand-apply DDL to the production
project via the dashboard SQL editor or an ad-hoc MCP/CLI session.

## Why

`supabase db push` compares the **remote** migration history against the
**local** migration files by their version timestamp (the `YYYYMMDDHHMMSS`
filename prefix). If the remote history contains a version that has no
matching local file, the push aborts for the whole run with:

```
Remote migration versions not found in local migrations directory.
```

Hand-applying a migration out-of-band records it under an _apply-time_
timestamp that never matches the repo filename. That single orphan version
wedges the integration: it stops applying **all** later migrations, and the
branch goes to `MIGRATIONS_FAILED`. The failure is silent from the app's
side until a feature hits a table/RPC that never got deployed.

## If the history ever drifts again

1. Compare recorded history to the repo:
   ```sql
   select version, name from supabase_migrations.schema_migrations order by version;
   ```
   vs. `ls supabase/migrations/`.
2. Snapshot before touching it:
   ```sql
   create table supabase_migrations.schema_migrations_backup_<date> as
     select * from supabase_migrations.schema_migrations;
   ```
3. Align each recorded row's `version` to its repo filename timestamp, drop
   orphan rows whose effects are folded into consolidated repo migrations,
   and apply any genuinely-missing migrations (idempotently). The end state:
   `schema_migrations` mirrors `supabase/migrations/` exactly.
4. The next push to `main` then runs clean and the branch leaves
   `MIGRATIONS_FAILED`.

## Writing migrations so a re-run is safe

Keep migrations idempotent: `create table if not exists`,
`create index if not exists`, `create or replace function`, and guard
`create policy` / `create trigger` with `drop ... if exists` or a
`pg_policies` / `pg_trigger` existence check. This makes a re-apply a no-op
and keeps recovery painless.
