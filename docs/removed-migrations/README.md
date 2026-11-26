# Removed migrations

SQL that ran against production but has no migration file in this repo.

These are **not** applied by `supabase db push` — nothing in this directory is a
live migration. They are kept as a record, so a schema change that reached the
production database is never lost just because its file never got committed.

## Why this directory exists

Three migrations were applied straight to production in July 2026 and their SQL
was never committed:

|     Version      |             Name              |                                   Created                                   |
|------------------|-------------------------------|-----------------------------------------------------------------------------|
| `20260705000000` | `office_approval_enforcement` | `office_approvals`, `office_role_can_approve()`, `office_decide_approval()` |
| `20260707130000` | `office_program`              | `office_workflows`, `office_audit_log`                                      |
| `20260709120000` | `office_invite_tokens`        | `office_invite_tokens`                                                      |

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

## Applied by hand under other versions (November 2026)

A second, different case. Two migrations were applied straight to production
**and also committed**, but production recorded them under the timestamp of the
moment they were applied, not the version in the file name. The recorded
versions therefore have no file, and `supabase db push` refuses to run for the
same reason as above (`Remote migration versions not found in local migrations
directory`). `DB Migrate` failed on every run from 2026-11-03 17:54 UTC, and no
migration after `20261104144109` reached production in that time.

|                Recorded version                |          Repo file (the live migration)          | Bytes |     md5 of recorded statement      |
|------------------------------------------------|--------------------------------------------------|-------|------------------------------------|
| `20261103175342` `signature_block_email_phone` | `20261103150000_signature_block_email_phone.sql` | 571   | `965c180a06ccd04cac66dcaf7519b540` |
| `20261104144109` `record_envelope_signature`   | `20261104110000_record_envelope_signature.sql`   | 2773  | `7e8db9a1254b8e1a4acf56c97b3dfb29` |

The files here are the SQL production recorded, one statement each, copied
before the rows are cleared. Each md5 above was computed by the database over
the recorded statement and matches these files with their final newline
removed. Compared with the repo files, the recorded SQL is identical apart from
the repo files' leading comment block, and both changes are present in the
production schema (the `envelope_fields_field_type_check` constraint allows
`email` and `phone`; `record_envelope_signature` exists, `security definer`,
executable by `service_role` only).

Because the repo files are the live migrations and are written to be run twice
safely, nothing is lost by clearing the two history rows: `db push` re-applies
the repo files harmlessly under their own versions. The fix is the same repair
as before, run with production credentials:

```
supabase migration repair --status reverted 20261103175342 20261104144109
```

then let `DB Migrate` run. **This had not been run when this section was
written**; update this paragraph once the rows are cleared and the workflow is
green.

## Restoring a record

Nothing here should be re-applied — `drop_virtual_office` deliberately removed
these objects. If a history row ever needs to come back, insert it with the
matching file's contents as its `statements`.

## The rule this is here to enforce

Apply schema changes through a committed migration file, not through the
dashboard SQL editor or an ad-hoc tool call. A change applied out-of-band leaves
production and the repo disagreeing, and the disagreement surfaces much later as
a blocked pipeline rather than as an error at the time.
