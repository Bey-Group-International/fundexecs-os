# Migrations

Every change to the production schema goes in a file here, and reaches
production exactly one way.

```
commit a migration  ->  pull request  ->  merge to main  ->  db-migrate.yml  ->  production
```

That is the whole sanctioned path. `db-migrate.yml` runs `supabase db push
--include-all` on every push to `main` that touches this directory, and then
checks that the repository and production agree.

## The one rule

**Do not apply SQL to production by hand.** Not through the Supabase SQL
editor, not through `apply_migration` against the live project, not through
`psql`. Not "just this once to unblock something", and not even when the SQL is
identical to the file you are about to commit.

The reason is not process hygiene. It is that a hand-apply **records the
version**, and `supabase db push` applies a version at most once:

```
hand-apply the SQL      -> production records version V
commit the file for V   -> db push sees V already recorded, SKIPS the file
```

From that moment the committed file has never executed and never will. Whatever
actually ran is whatever was typed, and nothing compares the two — not CI, not
the drift check, not a reviewer. The schema might match the file. It might be a
line short. There is no longer any way for the pipeline to tell you which.

This has happened. `20260930160131`, `20260930162312` and `20261001000944` were
each applied out of band, and each blocked every later migration until it was
sorted out, while every pull-request check stayed green. (The executable SQL did
turn out to match in all three cases — checked statement by statement after the
fact. That was luck, not a property anything enforced.)

An earlier round was worse: three July 2026 migrations were applied straight to
production and their files were *never* committed, which wedged `db push`
entirely for a month. See [`docs/removed-migrations/README.md`](../../docs/removed-migrations/README.md).

## Writing one

```bash
printf '%s\n' "$(date -u +%Y%m%d%H%M%S)"        # the version
```

Name the file `<version>_<snake_case>.sql`. The 14 digits are a UTC timestamp;
they are what orders the migration and what production records, and neither can
be changed afterwards without a repair. (The 66 four-digit files — `0001_init.sql`
through `0066_artifact_grounding.sql` — predate this and are left alone.)

**Make it re-runnable.** Every statement should be safe to apply twice:

|                                statement                                |                                                            safe form                                                             |
|-------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| `create table` / `index` / `schema` / `extension` / `materialized view` | add `if not exists`                                                                                                              |
| `add column`                                                            | `add column if not exists`                                                                                                       |
| any `drop`                                                              | add `if exists`                                                                                                                  |
| `create function` / `view` / `procedure` / `trigger`                    | `create or replace`                                                                                                              |
| `add constraint`                                                        | wrap in a `do $$ … if not exists (select 1 from pg_constraint where conname = … and conrelid = …::regclass) then … end $$` block |
| `create policy` / `create type`                                         | `drop … if exists` the same name first, or use a guard block                                                                     |
| `insert`                                                                | `on conflict do nothing`                                                                                                         |

PostgreSQL has no `if not exists` for constraints, policies or types, which is
why those three need a guard block or a preceding drop. A `do $$ … $$` block is
a *single statement*, so everything inside it commits together even when the
file is applied statement by statement — which is also what makes a
drop-and-replace of a constraint atomic. See
`20261001042344_meeting_deal_org_fk.sql` for the pattern.

Re-runnability is not style. It is what makes a migration *recoverable*: the
repair procedure below works by letting `db push` apply the file again.

## What is checked, and when

|          check           |                    runs                    |                                                                        catches                                                                         |
|--------------------------|--------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| `migration-check.yml`    | every pull request touching this directory | editing a merged migration, deleting one, a malformed or colliding version, an out-of-order version, statements that cannot be applied twice           |
| `db-migrate.yml` — push  | push to `main`                             | the migration failing to apply                                                                                                                         |
| `db-migrate.yml` — drift | push to `main`                             | a repo migration missing from production; a production version with no file here; **a migration this push added that production had already recorded** |

The pull-request check holds no database credentials, deliberately: on
`pull_request` the workflow file comes from the branch under test, so a secret
available to it is available to anything anyone pushes. Everything it enforces
is a fact about the diff. The one shape that genuinely needs the remote history
— a version already recorded out of band — is detected by `db-migrate.yml`,
which already holds those credentials and only ever runs from `main`.

The rules themselves are in [`lib/db/migration-rules.ts`](../../lib/db/migration-rules.ts),
which is pure and unit-tested. To run them before pushing:

```bash
npx tsx scripts/check-migrations.ts          # against origin/main
npx tsx scripts/check-migrations.ts <ref>    # against something else
```

## Recovery

### Something was already applied by hand

Production has version `V` and `db push` is skipping the file. First find out
whether it actually matters:

```sql
-- What production recorded for V, versus what the file says.
-- A NULL means the version was stamped and no SQL ran through the pipeline at all.
select version, name, statements
from supabase_migrations.schema_migrations
where version = 'V';
```

Compare that against the executable SQL in `V_*.sql`, ignoring comments. Then:

- **They match.** Nothing to fix. The schema is right and the version is
  recorded; the only cost is that it was never verified.
- **They differ**, or the statements are `NULL`. Clear the row and let the
  pipeline apply the real file:

  ```bash
  supabase migration repair --status reverted V
  ```

  then re-run `db-migrate.yml`. This only works if the file is idempotent,
  which is the point of the table above.

### A version is recorded with no file here

`db push` refuses to apply **anything** in this state, so every pending
migration is blocked, not just the one. Either restore the file, or copy its
SQL into `docs/removed-migrations/` and clear the row:

```bash
supabase migration repair --status reverted V
```

Copy the SQL out *first*. Once the row is gone, what production ran is gone with
it.

### A merged migration is wrong

Add a new migration that corrects it. Do not edit the old file — its version is
already recorded, so the edit will never run. `migration-check.yml` treats
editing a merged migration's SQL as an error for exactly this reason; changing
only its comments is fine and is reported as a note.

## Which recorded migrations never ran through the pipeline

```sql
select version, name
from supabase_migrations.schema_migrations
where statements is null
order by version;
```

A `NULL` `statements` means the version was marked applied without the
migration system executing any SQL — a `migration repair --status applied`,
which is what a hand-apply gets tidied up with. Nothing has ever verified those
against their files. As of 2026-10-01 there are five
(`20260825170000`, `20260925060000`, `20260930060000`, `20260930070000`,
`20260930080000`); every object they describe was confirmed present in
production on that date.

## Making these checks actually block

Everything above reports. Nothing above prevents, until the checks are required
in branch protection — which is a repository setting, not a commit: Settings →
Branches → branch protection for `main` → Require status checks to pass.

**Add these, exactly as written.** Branch protection matches the CHECK RUN
name, which is the job's `name:` — not the workflow's. Typing the workflow name
produces a required check that never reports, which is the deadlock described
below.

```
Check migrations              # migration-check.yml, job `check`
Lint, Typecheck & Build       # ci.yml, job `lint-and-typecheck`
Visual layout checks          # ci.yml, job `visual`
test                          # jest.yml, job `test` — it has no `name:`, so this is its id
zizmor                        # workflow-security.yml, job `zizmor`
```

### Why `paths:` and required checks cannot be combined

`migration-check.yml` and `jest.yml` both carried a `paths:` filter on their
`pull_request` trigger, and both have had it removed, because a path-filtered
workflow **does not report a skipped check — it reports nothing at all**.
Branch protection reads a required check that never arrives as still expected,
so the pull request can never merge, and there is nothing red on the page to
explain why. The two checks carrying the most signal were the two that could
not be made to gate anything.

The "skip companion" pattern — a sibling workflow with the inverse
`paths-ignore` and a job of the same name reporting green — was considered and
rejected. Getting the inverse wrong is worse than the problem in both
directions: too narrow restores the deadlock, and too wide runs BOTH, putting a
check of the same name that always passes beside the real one, where it can
mask a red run.

So both now run on every pull request. `scripts/check-migrations.ts` exits 0
and says "No migrations changed" when the diff holds none, so the common case
is a fast green.

### `DB Migrate` cannot be a required check, and this is the residual

**A red `DB Migrate` run still blocks nothing.** That is how the expired
`SUPABASE_ACCESS_TOKEN` went unnoticed from 2026-07-19 for a month: every run
died at `supabase link` and every merge looked fine.

It cannot be fixed by requiring it, and the reason is structural rather than an
oversight: `db-migrate.yml` runs on `push: main`. It only ever executes AFTER
the merge, so it has no check run on the pull request for branch protection to
wait on. Requiring it would block every pull request forever.

What that leaves: a migration can still fail to reach production and the next
pull request will merge green on top of it. The pull-request checks above stop
a migration that is *wrong*; nothing stops one that is *right* and fails to
apply. Watching `DB Migrate` on `main` after a merge is a human obligation, and
this paragraph exists so that nobody has to rediscover why.
