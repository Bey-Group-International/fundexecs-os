# FundExecs OS — Test Credentials (live `emityvdaeiqxtpxdhyky` project)

## Status: NOT PROVISIONED — DB password rejected

No test users have been created. The migration `20260606120000_general_signup_seed_and_member_type_topup.sql` has NOT been applied to live yet, because the DB password provided (`@10DoobieZ`) was rejected by Postgres on every attempt.

Reachability checks confirm the project + tenant are correctly located on the
new Supabase pooler infrastructure at `aws-1-us-east-1.pooler.supabase.com`,
username `postgres.emityvdaeiqxtpxdhyky`, ports 5432 and 6543. The username
format is right (other regions reject as `ENOTFOUND`, this one accepts the
tenant), but every password I tried was rejected with
`FATAL: password authentication failed for user "postgres"`.

Service-role REST keeps working — `count(*) from ai_brains` returns 15.
That's the project's API role, not the `postgres` role used by `psql`.

### Next step (user)

Either:

- **Reset the DB password** in Supabase Dashboard → Project Settings →
  Database → "Reset database password" — and paste the new value here.
  Connect path will be:
  ```
  PGHOST=aws-1-us-east-1.pooler.supabase.com
  PGPORT=5432
  PGDATABASE=postgres
  PGUSER=postgres.emityvdaeiqxtpxdhyky
  PGPASSWORD=<new password>
  PGSSLMODE=require
  ```
- **OR** issue a Personal Access Token at
  `https://supabase.com/dashboard/account/tokens` and paste it. I'll apply
  the migration via `POST https://api.supabase.com/v1/projects/emityvdaeiqxtpxdhyky/database/query`
  instead.

### What will happen next, once the credential lands

1. `psql -v ON_ERROR_STOP=1 -f supabase/migrations/20260606120000_general_signup_seed_and_member_type_topup.sql` — apply twice to prove idempotency.
2. Verify `\df public.seed_demo_baseline_for_org`, `\df public.seed_demo_for_member_type`, `\df public.handle_new_user`.
3. Create 5 test users via `supabase.auth.admin.createUser` (one per `member_type`), shared random password, `email_confirm: true`.
4. Wait for the new `handle_new_user` trigger to fire (auto-creates org + baseline seed).
5. Call `seed_demo_for_member_type` server-side for each test user to land the per-type top-up rows.
6. Leave each `member_profiles.status = 'draft'` so the onboarding gate redirect is testable.
7. Populate the credentials table in this file.

| member_type | email       | user_id | org_id | member_profile_id | status |
| ----------- | ----------- | ------- | ------ | ----------------- | ------ |
| _(pending)_ | _(pending)_ | —       | —      | —                 | —      |

(table to be filled once the DB password / PAT lands)
