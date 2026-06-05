# FundExecs OS — Test Credentials (live `emityvdaeiqxtpxdhyky` project)

## Status: ✅ PROVISIONED — ready for tester sweep

Migration `20260606120000_general_signup_seed_and_member_type_topup.sql`
plus two patch migrations are applied to the live DB and 5 test users
exist (one per `member_type`), each with their own auto-created org and a
baseline + per-type seed.

### Patches applied on top of the base migration

| migration | reason |
| --------- | ------ |
| `20260606123000_fix_handle_new_user_org_type.sql` | base migration used `'investment'` for `organizations.type`, which is not a member of the `org_type` enum (`fund | lp | operator | capital_provider | service_provider | partner`). Auth signups failed with `invalid input value for enum org_type`. Patch switches the auto-created org to `'operator'`. |
| `20260606123500_fix_seed_baseline_multi_row_returning.sql` | `seed_demo_baseline_for_org` did a multi-row `INSERT … RETURNING id INTO _contact_a` (single scalar). The original author's comment claimed PL/pgSQL would silently capture the last value — it actually throws `TOO_MANY_ROWS`. Patch drops the bogus `RETURNING` and relies on the existing `SELECT id INTO …` lookups. |

Both patches are additive (`CREATE OR REPLACE FUNCTION`) and the SQL is
safe to re-apply.

## Sites

- **Public site**: <https://www.fundexecs.com>
- **Supabase auth**: <https://auth.fundexecs.com> (CNAME → `emityvdaeiqxtpxdhyky.supabase.co`)
- **Preview**: rotate from the latest Vercel deploy (this pod does not host a preview)

## Auth type

Email + password (Supabase GoTrue). All 5 test users are
`email_confirmed: true`. No SSO involved.

## Shared password

```
FundExecsTest!2026X9k7Lqr
```

## 5 test users

All organizations were auto-created by the `handle_new_user` trigger on
signup. `member_profiles` is keyed by `user_id` (no separate `id` PK), so
the "member profile id" column below is the same value as `user_id`.

| member_type           | email                                              | user_id (= member_profile_id)            | org_id                                   | member_profile status |
| --------------------- | -------------------------------------------------- | ---------------------------------------- | ---------------------------------------- | --------------------- |
| `investment_firm`     | test+investment_firm@fundexecs-staging.dev         | `28bebb95-ab79-4039-b604-8db44d4be4b3`   | `145668b7-f739-4b5a-9207-f479b94b197b`   | `in_progress`         |
| `service_provider`    | test+service_provider@fundexecs-staging.dev        | `c1bec9de-0e48-42ac-9ab0-807ca4fd0005`   | `ccbbfee0-ab07-4dc8-8e72-81bbd6b940c2`   | `in_progress`         |
| `startup`             | test+startup@fundexecs-staging.dev                 | `23d995fa-91d3-4a08-b671-dba690de867b`   | `76fd7336-0e1d-4930-b5ee-26a42b12269d`   | `in_progress`         |
| `student`             | test+student@fundexecs-staging.dev                 | `f60306b9-644d-46ea-832b-eabf1f6b066a`   | `0b7805d5-4a11-4021-aaa8-602073d77140`   | `in_progress`         |
| `individual_investor` | test+individual_investor@fundexecs-staging.dev     | `efd97e2c-4f71-4f8e-a8e1-46891ce90491`   | `12363079-7bd6-4eb5-898d-0269bcf032e7`   | `in_progress`         |

All five users are intentionally left with `member_profiles.status =
'in_progress'`. That exercises the bidirectional middleware gate:
hitting any protected route (`/command-center`, `/pipeline`, `/strategy`,
etc.) redirects to `/onboarding`.

### Flip a user to `complete` so the dashboard renders

To test a personalized dashboard for a single member_type, set status to
`complete`. The gate then bounces `/onboarding` → `/command-center`.

```sql
update public.member_profiles
   set status = 'complete', completion_pct = 100
 where user_id = '<paste user_id from table above>';
```

Reverse with:

```sql
update public.member_profiles
   set status = 'in_progress', completion_pct = 0
 where user_id = '<paste user_id from table above>';
```

DB connection that works from this pod:

```
PGHOST=aws-1-us-east-1.pooler.supabase.com
PGPORT=5432
PGDATABASE=postgres
PGUSER=postgres.emityvdaeiqxtpxdhyky
PGPASSWORD=@1Emergent2026
PGSSLMODE=require
```

Service-role key + project URL also live in `/app/.env.local` and can be
used from any service-role REST call.

## Row-count snapshot (acceptance check)

All 5 users include the baseline seed (3 contacts, 5 interactions, 3
governance objectives, 1 partnership / service provider / capital
provider, 2 welcome notifications, 1 chain-of-trust record) on top of
the per-type top-up. Counts below are TOTAL per org after both seeds
ran.

| member_type                                | acceptance criteria from brief                                                                  | deals | allocations | capital_providers | contacts | warm_introductions | governance_objectives | notifications | chain_of_trust_records | synergy_opportunities | tasks | pass? |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----- | ----------- | ----------------- | -------- | ------------------ | --------------------- | ------------- | ---------------------- | --------------------- | ----- | ----- |
| `investment_firm`                          | ≥6 deals                                                                                       |   6   |      3      |         3         |    3     |         0          |           3           |       3       |           1            |           1           |   0   |   ✅   |
| `service_provider`                         | ≥5 inbound deals + ≥3 ideal-client contacts                                                    |   5   |      0      |         1         |    6     |         0          |           3           |       5       |           1            |           0           |   0   |   ✅   |
| `startup`                                  | ≥4 investor contacts + 1 raise deal + ≥3 tasks + 2 warm intros                                 |   1   |      0      |         1         |    7     |         2          |           3           |       3       |           1            |           0           |   3   |   ✅   |
| `student`                                  | ≥3 learning tasks + ≥4 curated notifications + ≥2 network contacts                             |   0   |      0      |         1         |    5     |         0          |           3           |       7       |           1            |           0           |   3   |   ✅   |
| `individual_investor`                      | ≥5 deals + ≥3 allocations + ≥1 watchlist synergy + ≥2 syndicate contacts                       |   5   |      3      |         1         |    5     |         0          |           3           |       3       |           1            |           1           |   0   |   ✅   |

Notes for the tester:

- `notifications` counts include the baseline `welcome` + `task` rows AND
  the per-type top-up's tagged seed row(s).
- `contacts` for `startup`, `service_provider`, `student`, and
  `individual_investor` is higher than the per-type minimum because the
  baseline seed contributes 3 generic contacts on top of the type-specific
  ones.
- `tasks` is `0` for `investment_firm`, `service_provider`, and
  `individual_investor` because the per-type seed for those does not write
  tasks (matches the brief).
- All 5 orgs have `governance_plans = 1`, `service_providers = 1`,
  `partnerships = 1` from the baseline.
- Idempotency: re-running `node scripts/provision-test-users.cjs` is a
  no-op — the seed RPCs key off a tag in `notifications.payload->>'tag'`
  and skip if the tag exists.

## How to re-run / regenerate

```bash
# 1) Apply (or re-apply — idempotent) the patches
export PGPASSWORD='@1Emergent2026'
psql "host=aws-1-us-east-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.emityvdaeiqxtpxdhyky sslmode=require" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260606120000_general_signup_seed_and_member_type_topup.sql \
  -f supabase/migrations/20260606123000_fix_handle_new_user_org_type.sql \
  -f supabase/migrations/20260606123500_fix_seed_baseline_multi_row_returning.sql

# 2) Re-run the provisioning script (idempotent — reuses existing users)
set -a && source .env.local && set +a
node scripts/provision-test-users.cjs
```
