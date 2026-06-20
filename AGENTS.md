# AGENTS.md

> Product/architecture context lives in `README.md` and `AGENT.md` (the "living
> development prompt"). This file holds operational guidance for agents working
> in this repo.

## Cursor Cloud specific instructions

FundExecs OS is a single **Next.js 14 (App Router) + TypeScript + Tailwind** app
backed by a local **Supabase** stack (Postgres + Auth + PostgREST + Realtime),
run via Docker. The core product is the **AI Agent Copilot** loop
(prompt → plan → approve → execute) on top of an org-scoped, RLS-protected schema.

### Services & how to run them

- **Local Supabase stack** (Docker): `supabase start` (applies `supabase/migrations/`).
  Studio at `http://127.0.0.1:54323`, API at `http://127.0.0.1:54321`. Stop with
  `supabase stop` (`--no-backup` also deletes the data volume).
- **Next.js dev server**: `npm run dev` → `http://localhost:3000`. Needs `.env.local`
  (gitignored). Populate it from `supabase status -o env` (use the JWT
  `ANON_KEY` / `SERVICE_ROLE_KEY`) plus `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
- Lint/test/build/typecheck use the standard scripts in `package.json`
  (`npm run lint`, `npm test` (Jest), `npm run build`, `npm run typecheck`).

### CRITICAL: do not upgrade the Supabase CLI past v2.72.7

The local Supabase CLI is intentionally pinned to **v2.72.7**. Newer CLIs
(>= ~2.74.4) break this repo's local stack because the migrations were written
for the older Supabase defaults:

- Newer CLIs sign user session JWTs with **ES256** but configure PostgREST's
  `PGRST_JWT_SECRET` with only the legacy **HS256** secret (not the JWKS), so
  user tokens never verify, `auth.uid()` is `NULL` in RLS, and **every
  authenticated write fails**. v2.72.7 wires the JWKS into PostgREST so both
  legacy keys and ES256 user tokens verify.
- Newer CLIs also flip `[api].auto_expose_new_tables` to `false`, which yields
  `permission denied for table ...` (42501) because the migrations have no
  per-table grants. v2.72.7 auto-exposes `public` tables.

If `supabase --version` is not `2.72.7`, reinstall it before starting the stack
(single-binary tarball: `supabase_linux_amd64.tar.gz` from the `v2.72.7` GitHub
release, placed on `PATH`). Do **not** run `supabase --update`.

### Known app bug: onboarding org creation fails under RLS

Completing onboarding ("Launch workspace") fails with
`new row violates row-level security policy for table "organizations"`. This is
a latent **app bug** (the flow is "Integrated, not yet tested" per `AGENT.md`),
not an environment problem. `createOrganization` (`app/onboarding/actions.ts`)
does `.insert(...).select("id").single()`; Postgres applies the
`organizations_select` policy to the `INSERT ... RETURNING` rows, but the
owner membership is created by the `handle_new_organization` AFTER-INSERT
trigger and is not visible to the statement's snapshot via the STABLE
`current_principal_org_ids()`, so the returning row is not SELECT-visible.

To test the rest of the app (the Copilot loop etc.) without touching app code,
seed an org + owner membership directly for a test user, then sign in. As
`postgres` the AFTER trigger is skipped (it only fires `WHEN auth.uid() IS NOT
NULL`), so insert both rows yourself:

```sql
-- after the user has signed up (so auth.users + principals exist):
insert into public.organizations (name, slug, created_by)
values ('Demo Capital Partners','demo-capital-partners', '<auth_user_id>')
on conflict (slug) do nothing;
insert into public.organization_members (organization_id, principal_id, role)
select id, '<auth_user_id>', 'owner' from public.organizations
where slug='demo-capital-partners'
on conflict do nothing;
```

For the Copilot flow itself this works because the signed-in user is already a
member, so RLS SELECT policies pass for normal `.insert().select()` writes.

### Other caveats

- The AI Copilot works without `ANTHROPIC_API_KEY` — it falls back to a
  deterministic multi-step plan and step output (cards read "Connect
  ANTHROPIC_API_KEY for a full AI-generated deliverable"). Set the key for real
  Claude plans. Stripe / integration channels are likewise optional (mock mode).
- If a freshly started stack returns a transient 42501 on the first
  auth-protected writes, run `NOTIFY pgrst, 'reload schema';` against the local
  DB (port 54322) and retry; the schema/connection state settles after that.
- Email confirmations are disabled locally (`supabase/config.toml`), so signup
  yields an immediate session.
