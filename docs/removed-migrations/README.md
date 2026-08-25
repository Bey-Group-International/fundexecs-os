# Removed migrations

SQL that ran against production but has no migration file in this repo.

These are **not** applied by `supabase db push` — nothing in this directory is a
live migration. They are kept as a record, so a schema change that reached the
production database is never lost just because its file never got committed.

## Why this directory exists

Three migrations were applied straight to production in July 2026 and their SQL
was never committed:

| Version | Name | Created |
|---|---|---|
| `20260705000000` | `office_approval_enforcement` | `office_approvals`, `office_role_can_approve()`, `office_decide_approval()` |
| `20260707130000` | `office_program` | `office_workflows`, `office_audit_log` |
| `20260709120000` | `office_invite_tokens` | `office_invite_tokens` |

All four tables were later dropped by
`supabase/migrations/20260719000000_drop_virtual_office.sql` when the Virtual
Office feature was removed, so nothing they created still exists in production.

What did still exist were their three rows in
`supabase_migrations.schema_migrations`. That was enough to wedge the pipeline:
`supabase db push` refuses to run while the remote history contains versions the
local migrations directory has no file for —

```
Remote migration versions not found in local migrations directory.
```

so *every* subsequent migration was blocked by bookkeeping for a feature that
had already been deleted. The three rows were cleared (the equivalent of
`supabase migration repair --status reverted 20260705000000 20260707130000
20260709120000`), and the SQL was copied here first. The files below are
byte-for-byte what production recorded, verified by md5 before the rows were
removed.

## Restoring a record

Nothing here should be re-applied — `drop_virtual_office` deliberately removed
these objects. If a history row ever needs to come back, insert it with the
matching file's contents as its `statements`.

## The rule this is here to enforce

Apply schema changes through a committed migration file, not through the
dashboard SQL editor or an ad-hoc tool call. A change applied out-of-band leaves
production and the repo disagreeing, and the disagreement surfaces much later as
a blocked pipeline rather than as an error at the time.
