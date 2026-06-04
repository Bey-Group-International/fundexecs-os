# FundExecs OS — Architecture & Roadmap

This document captures the phased plan to take FundExecs OS from scaffold to
product. It complements the vision in `README.md` with a concrete build order,
a proposed data model, and conventions.

## Guiding principles

- **Ship the foundation before features.** Reproducible builds, CI, auth, and a
  clean data model first — they make every later module cheaper and safer.
- **Server-first.** Use React Server Components + Server Actions by default;
  reach for Client Components only for interactivity.
- **Supabase as the source of truth.** Auth, Postgres, RLS, storage, and
  realtime. Enforce access with Row Level Security on every table.
- **Proof-based progress.** The "Chain of Trust" is a first-class concept —
  model actions as auditable events, not just state.

## Tech stack

| Layer     | Choice                                  |
| --------- | --------------------------------------- |
| Framework | Next.js (App Router) + React 19         |
| Language  | TypeScript (strict)                     |
| Styling   | Tailwind CSS v4                         |
| Backend   | Supabase (Postgres, Auth, RLS, Storage) |
| Icons     | lucide-react                            |
| Hosting   | Vercel                                  |
| CI        | GitHub Actions (typecheck/lint/build)   |

## Phases

### Phase 0 — Foundation (in progress)

- [x] Pin dependencies to concrete versions (reproducible builds)
- [ ] Commit `package-lock.json` (run `npm install` in a local clone and commit
      the generated lockfile to fully lock the dependency tree)
- [x] Fix Tailwind v4 / PostCSS setup (styling now compiles)
- [x] `.gitignore`, ESLint, Prettier
- [x] App Router robustness: `error`, `loading`, `not-found`, SEO metadata
- [x] GitHub Actions CI (typecheck, lint, build)
- [x] Vercel config

### Phase 1 — Auth & app shell (started)

- [x] Design system: ported color/type/spacing/elevation tokens into Tailwind v4
      `@theme` and wired the Geist font (`next/font`) — see the FundExecs OS
      design system; primary CTA stays white per the shipped app
- [x] Supabase browser/server/middleware clients
- [x] Session-refreshing middleware + protected-route gating
- [x] Login / sign-up page + auth callback + sign-out
- [ ] User onboarding flow (profile, role selection)
- [ ] Authenticated app shell (nav, layout) for the Command Center
- [ ] Role-based access (fund, LP, operator, capital provider, partner, admin)

### Phase 2 — Core data & Command Center

- [x] Define schema + RLS migrations (see `supabase/migrations/`) — all 9 core
      tables, org-scoped Row Level Security, signup trigger, `create_organization`
      RPC, and generated typed bindings (`lib/supabase/database.types.ts`)
- [ ] Onboarding: call `create_organization` + set `profiles.role` after signup
- [ ] Command Center Dashboard (KPIs, activity, next actions)
- [ ] Notification Center

### Phase 3 — Pipeline & governance

- [ ] Deal / Allocation / Partnership pipeline (kanban + detail views)
- [ ] 100/30/10 Governance Plan
- [ ] Chain of Trust progress system (event-sourced, auditable)

### Phase 4 — Intelligence

- [x] Schema reconciled toward the product blueprint: ecosystem directory
      (service/capital providers), 100/30/10 governance, synergy opportunities,
      Chain-of-Trust state (records/proof layers/evidence), admin audit
- [x] AI knowledge base for the "Earn" brains — pgvector RAG
      (`ai_brains`, `knowledge_documents`, `knowledge_chunks`,
      `brain_routing_rules`, `match_knowledge_chunks()`), org-scoped + global
- [x] Integrations + relationship intelligence (warm connections):
      `integration_connections` (provider-agnostic), `contacts` /
      `contact_identities`, normalized `interactions`, auto-scored
      `relationships` (recency + frequency trigger), and `warm_introductions`
- [ ] Wire provider sync (Gmail, Google/Outlook Calendar, Calendly, Slack,
      Apollo, …) into `interactions`; embed knowledge into `knowledge_chunks`
- [ ] AI Copilot Task Manager
- [ ] Private Market Lifecycle Intelligence
- [ ] Bey Group Admin Portal

## Proposed data model (Phase 2 starting point)

> Sketch — refine before writing migrations. All tables get `id uuid pk`,
> `created_at`, `updated_at`, and RLS scoped to the owning org/user.

- `profiles` — 1:1 with `auth.users`; `full_name`, `role`, `org_id`.
- `organizations` — funds/firms; `name`, `type`, `tier`.
- `org_members` — membership join (`org_id`, `user_id`, `role`).
- `deals` — `org_id`, `name`, `stage`, `amount`, `owner_id`, `status`.
- `allocations` — `deal_id`, `lp_id`, `amount`, `status`.
- `partnerships` — `org_id`, `counterparty`, `type`, `stage`.
- `tasks` — `org_id`, `assignee_id`, `title`, `due_at`, `status`, `source`.
- `trust_events` — append-only audit log powering Chain of Trust
  (`org_id`, `actor_id`, `entity_type`, `entity_id`, `action`, `metadata`).
- `notifications` — `user_id`, `type`, `payload`, `read_at`.

## Local development

1. `cp .env.example .env.local` and fill in Supabase keys.
2. `npm install`
3. `npm run dev` → http://localhost:3000

## Deployment (Vercel)

1. Import the repo in Vercel (framework auto-detected as Next.js).
2. Add env vars in Vercel → Settings → Environment Variables:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Pushes to `main` deploy to production; PRs get preview URLs automatically.
