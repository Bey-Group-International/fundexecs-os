# Test credentials — Phase 2 / 3 foundationals (partial)

## Status

**No test users have been self-provisioned yet.**

The Phase 2/3 brief asked me to apply the new migration to the live
`emityvdaeiqxtpxdhyky` project, then create 5 demo users (one per
`member_type`) via the service-role admin API and record their credentials
here. I have the service-role key but I am missing the SQL-execution path
required to apply the migration. See the message that accompanies this file
for the credential question.

Until the migration is applied to live, calling
`supabase.auth.admin.createUser(...)` would still create accounts, but
`handle_new_user` on the live DB is the OLD version (Bey-only) — so those
accounts would land without an org or a baseline seed. I'd rather not create
half-broken accounts.

## What is on the live DB right now (verified via PostgREST + service-role key)

| Check | Result |
|---|---|
| Reachability of `https://auth.fundexecs.com` | ✅ |
| `auth.fundexecs.com` / `emityvdaeiqxtpxdhyky.supabase.co` DNS | ✅ resolves |
| `select count(*) from public.ai_brains` | **15** |
| `select count(*) from public.knowledge_chunks` | **15** |
| All 15 brain slugs match `lib/ai/brains.ts` | ✅ |

Live Earn RAG is fully embedded and operational. The migration I authored at
`supabase/migrations/20260606120000_general_signup_seed_and_member_type_topup.sql`
is queued for apply.

## Once the migration is applied

I will:
1. Verify idempotency by running it twice.
2. Create these 5 test users via `supabase.auth.admin.createUser`:
   - `test+investment_firm@fundexecs-staging.dev`
   - `test+service_provider@fundexecs-staging.dev`
   - `test+startup@fundexecs-staging.dev`
   - `test+student@fundexecs-staging.dev`
   - `test+individual_investor@fundexecs-staging.dev`
   Stable password: TBD (will be set during provisioning; recorded here).
3. For each: confirm `handle_new_user` auto-created the org + ran the
   baseline seed, then call `setMemberType` server-side to fire the
   per-type top-up. Record the resulting `user_id` + `org_id` + row counts
   below.

(table to be filled in once provisioning runs)
