# Contributing to FundExecs OS

Thank you for wanting to build this. FundExecs OS is an **open build** — see the
`README.md` for the vision and `AGENT.md` for the living architecture and build
discipline. Read both before starting.

## Build-order discipline (non-negotiable)

Per `AGENT.md`, we build in this sequence and never invert it:

```
1. Data model   — schema, migrations, RLS policies
2. API layer    — endpoints, GraphQL resolvers, auth
3. Agent logic  — task engine, handoff protocol, approval loop
4. WebSocket    — event emitters, client listeners
5. Frontend     — components, workspace, avatar animations
```

A beautiful UI on an unstable data model is a liability.

## Local setup

Prerequisites: **Node 20+**, **npm**, and the **Supabase CLI** (for a local DB).

```bash
# 1. Install dependencies
npm install

# 2. Copy env and fill in values
cp .env.example .env.local

# 3. Start the local Supabase stack (Postgres + Auth + Studio + Realtime)
npm run db:start
#    applies everything in supabase/migrations and the agent seed

# 4. (optional) Regenerate typed DB definitions after schema changes
npm run db:types

# 5. Run the app
npm run dev          # http://localhost:3000
```

If you don't have the Supabase CLI, the app still builds and the static
scaffold renders; database-backed features require the local stack.

## Repository structure

```
app/                  Next.js App Router (UI; built last)
lib/
  supabase/           client/server Supabase clients + DB types
  hubs.ts             four-hub catalog (source of truth for nav)
  agents.ts           six-agent catalog (mirrors the DB seed)
  events.ts           WebSocket / Realtime event model
supabase/
  config.toml         local stack config
  migrations/         versioned SQL — the data model (build it first)
AGENT.md              living development prompt / architecture
README.md             product overview
```

## Database changes

- Every schema change is a **new migration file** in `supabase/migrations/`
  (see the naming convention below). Never edit a migration that has been merged.
- Every table is **org-scoped** via `organization_id` and protected by **RLS**.
  New tables must enable RLS and add policies in the same migration set.
- Run `npm run db:reset` locally to confirm migrations apply cleanly from
  scratch before opening a PR.

### Database migrations: naming convention

**New migrations MUST be named `YYYYMMDDHHMMSS_snake_slug.sql`** — a 14-digit
**UTC** timestamp followed by a snake_case description, e.g.
`20260622100000_lp_onboarding_contracts.sql`. Do **not** use the legacy `00NN_`
sequence for anything new.

**Why.** The repo's history started on a sequential `00NN_*.sql` scheme, but the
data model now uses timestamped migrations. Mixing the two schemes is what causes
the recurring Supabase ⚠️ "out-of-order migration" warnings: a timestamp version
(e.g. `20260622100000`) sorts astronomically higher than any `00NN` number, so
every newly added `00NN` file applies *before* the already-applied timestamped
one on an incremental (preview/production) database. Timestamps generated at
creation time always sort **after** all prior history, so they apply in order and
the warnings stop.

**Existing migrations are intentionally left as-is.** They have already been
applied to production/preview databases, which track migrations by their version
string. Renaming or renumbering an applied migration makes the database think it
is missing/new and can trigger re-application or errors. So we never touch
historical files — the fix is **forward-only**: adopt timestamps from here on.

**Enforced in CI.** `lib/migrations-naming.test.ts` fails any migration that is
neither a grandfathered legacy `00NN_*.sql` file (numeric prefix ≤ the fixed
`LEGACY_MAX` cutoff, the highest legacy number at adoption) nor a valid 14-digit
timestamp file — so a *new* `00NN` file fails the build rather than slipping
through. `lib/migrations-unique.test.ts` additionally guards against duplicate
version prefixes. Run `npm test` before opening a PR.

> **Maintainers:** make the **`test`** workflow a **required status check** on
> `main` (Settings → Branches → branch protection). These guards only prevent bad
> migrations from reaching `main` if a red suite actually blocks merge; without
> the required check, duplicate-prefix collisions can still merge and need
> cleanup after the fact.

## Pull requests

1. Open a discussion before starting large features.
2. Keep PRs focused; respect the build order.
3. Run `npm run lint` and `npm run typecheck` before submitting.
4. Write a clear description of what changed and why.
5. If you make an architectural decision, append a changelog entry to
   `AGENT.md` — that file is the system's memory.

## Code style

- TypeScript everywhere; `strict` is on.
- Match the surrounding code's naming and comment density.
- Prefer the simpler implementation and flag follow-ups rather than
  over-engineering.

