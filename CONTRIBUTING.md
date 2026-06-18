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
  (`NNNN_description.sql`). Never edit a migration that has been merged.
- Every table is **org-scoped** via `organization_id` and protected by **RLS**.
  New tables must enable RLS and add policies in the same migration set.
- Run `npm run db:reset` locally to confirm migrations apply cleanly from
  scratch before opening a PR.

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
