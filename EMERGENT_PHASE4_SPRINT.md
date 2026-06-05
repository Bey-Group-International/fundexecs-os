# FundExecs OS — Emergent Sprint: Phase 4 → Working Beta

> **Mode:** Continue the existing repository (do **not** rebuild). Preserve the
> current stack, schema, design system, and all shipped work. This sprint takes
> the product from its current state to a **working beta** of the core member
> loop — usable by real beta users, with **member-type-personalized dashboards**
> and **mocked/seeded** third-party integrations.
>
> **Beta quality bar:** production-grade reliability on the core loop — real
> persistence, proper loading / empty / error states, and no dead ends — even
> though integrations are mocked and billing is deferred.

---

## 1. What exists today (do not redo — build on it)

**Stack:** Next.js 16 (App Router / RSC) · TypeScript · Tailwind CSS v4 (design
tokens in `app/globals.css`) · Geist fonts · Supabase (Auth + Postgres + RLS,
custom domain `api.fundexecs.com`) · Vercel. Anthropic Claude + Voyage
embeddings power the "Earn" copilot. CI = GitHub Actions **"Typecheck, lint &
build"** (`npm ci` → `format:check` → `build` → `typecheck` → `lint`).

**Auth & shell:** Email + Google OAuth (`app/login`), session refresh + route
gating in `proxy.ts` → `lib/supabase/middleware.ts` (with a guard that degrades
gracefully if Supabase env is missing). `components/shell/AppShell.tsx` =
sidebar nav, topbar (search, theme toggle, real signed-in identity, Earn-coin
XP wallet), the floating **Earn orb + Copilot dock**, and the **Chain-of-Trust
toaster + drawer**. Marketing landing at `/` (`app/page.tsx`).

**Data model (Supabase, RLS org-/user-scoped).** Key tables:
`organizations`, `org_members` (owner/admin/member), `profiles`
(`full_name`, `role`, `avatar_url`, `xp`, `member_type`), `member_profiles`
(the Proof-of-Truth profile: `display_name/headline/bio/focus_areas/links/
details/draft/status/completion_pct`), `deals`, `allocations`, `partnerships`,
`tasks`, `capital_providers`, `service_providers`, `contacts`,
`contact_identities`, `interactions`, `relationships`, `warm_introductions`,
`synergy_opportunities`, `integration_connections`, `notifications`,
`governance_plans`, `governance_objectives` (the 100/30/10 plan),
`chain_of_trust_records`, `proof_layers`, `evidence`, `trust_events`,
`ai_brains` (15 "brains"), `brain_routing_rules`, `knowledge_documents`,
`knowledge_chunks` (pgvector). RPCs: `create_organization`,
`match_knowledge_chunks`, `relationship_strength`, `seed_demo_for_user`,
`award_trust_xp`, `award_trust_xp`. Migrations live in `supabase/migrations/`.

**Features already built (server-page → client-view pattern):** Command Center,
Pipeline, Connections (relationship intelligence + warm intros), Integrations,
Strategy (100/30/10 governance objectives), Notifications, Admin, **Ask Earn**
(RAG chat over the 15 brains via `lib/ai/earn.ts` + `POST /api/ask-earn`),
unified card-state model (`lib/ui/useCardState.ts`), **Chain of Trust** (4 proof
layers Truth→Concept→Execution→Work, `window.emitTrust` bus, `award_trust_xp`
XP), and **Proof of Truth** (Phases 1–3):
- `lib/member-types.ts` (5 types), `lib/proof-of-truth/questions.ts`,
  `lib/proof-of-truth/earn-profile.ts`, `lib/ai/profile-suggest.ts`,
  `POST /api/earn/profile-suggest` → returns `{ insight, options[3] }`.
- `components/proof-of-truth/*` — conversational onboarding: member-type
  picker → per-field Earn **"Recommend"** (3 self-aware options, 👍 approve /
  👎 disapprove / ♾️ regenerate, **nothing enters the profile until approved**)
  → live profile panel → review → `saveMemberProfile`. Wired into
  `app/onboarding/*` and a Settings status card.

**Design system:** dark institutional palette; tokens `--bg-*`, `--surface-*`,
`--fg-1..5`, `--gold-1/2` (Earn/gamification only), `--azure-*`, `--accent`
(institutional-blue CTAs), proof-layer colors. Components in `@/components/ui`
(Button, Card, Badge, Input, Select, Tabs/SegTabs, ProgressBar, SectionTitle,
AnimatedNumber) + `EarnCoin`, `Avatar`. Motion is transform/opacity only on
`cubic-bezier(.22,.61,.36,1)`, with a `prefers-reduced-motion` guard. Tabular
figures for numbers. Gold is reserved for Earn/XP/progress.

---

## 2. Sprint goal (definition of done)

A brand-new user can: **sign up → complete Proof-of-Truth onboarding → land on a
dashboard personalized to their member type → move through the core loop
(Pipeline, Connections, Strategy, Chain of Trust, Earn copilot) with real
persistence and lively seed data → on desktop and mobile → with CI green.**

In scope: real data + working primary actions across the core loop;
**member-type-personalized dashboards**; rich **seed/demo data** per org;
**mocked/seeded** integrations behind the existing adapter interfaces; and
**beta-grade reliability** — every screen has loading / empty / error states and
no broken or dead-end actions.

Out of scope (defer): live third-party OAuth, billing/payments, email/push
delivery, multi-tenant admin tooling beyond what exists.

---

## 3. Phase-4 work items

**A. Member-type personalized dashboards (headline deliverable).**
Make `/command-center` (or a new `/dashboard`) render a layout tailored to
`profiles.member_type`, fed by the member's `member_profiles` + relevant data:
- `investment_firm` — deal flow / pipeline, capital deployed, sourcing, LP & co-investor matches.
- `service_provider` — inbound leads / engagements, ideal-client matches, services demand signals.
- `startup` — raise progress, investor matches against sector/stage, warm intros, materials checklist.
- `student` — learning path, the 15 brains, curated opportunities, network-building tasks.
- `individual_investor` — angel/LP deal flow, allocations, syndicate activity, watchlist.
Each pulls from real tables; each surfaces **Earn next-best-actions** and the
member's **Chain-of-Trust** standing. Reuse the design system and KPI/AnimatedNumber patterns.

**B. Make the core-loop actions real & persistent.** Audit every primary action
and ensure it writes to Supabase via server actions/route handlers with
server-side validation + RLS: create/edit **deals & allocations** (Pipeline),
**governance objectives** CRUD (Strategy), **notifications** read/dismiss,
**warm-introduction** requests (Connections), **member approval** (Admin),
**Settings** account/org save. Fire `emitTrust` + `award_trust_xp` on the
appropriate completions (the bus + RPC already exist).

**C. Chain of Trust end-to-end.** For a primary entity (e.g. a deal and the
member profile), implement the 4-layer proof pipeline with **evidence uploads**
(Supabase Storage), AI validation notes, and human approval, persisting to
`chain_of_trust_records` / `proof_layers` / `evidence` / `trust_events`; the
existing drawer should reflect real records and progress.

**D. Earn copilot live everywhere.** Ensure `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY`
are set and run `POST /api/knowledge/embed` once to embed the 15 brains; the
Copilot dock + Ask-Earn page answer over the brains; `profile-suggest` powers
the Proof-of-Truth flow. Keep the **never-block** degraded fallbacks.

**E. Seed / demo data.** Extend `seed_demo_for_user` (or add a migration + RPC)
so a fresh org is populated with realistic, varied, anonymized data across all
tables — enough that every screen and **each member-type dashboard** looks alive
immediately after onboarding.

**F. Mocked/seeded integrations.** Behind the existing
`lib/integrations/providers/*` adapter interfaces: a "Connect" action sets a
connected state and seeds `integration_connections` + `interactions` (no real
OAuth). Connections/relationship-intelligence screens render from that.

**G. Polish.** Mobile-responsive, accessible (semantic, focus rings,
reduced-motion), consistent with the design system, across the whole loop.

---

## 4. Hard constraints

1. **Preserve** the existing architecture, schema, RLS posture, auth/middleware,
   the landing page, and the design system. Migrations must be **additive** and
   idempotent; add them to `supabase/migrations/`.
2. **All writes server-validated**; respect RLS (org-/user-scoped). Never expose
   the service-role key to the client.
3. **CI must stay green**: `npm run build` (with placeholder Supabase env),
   `npm run typecheck`, `npm run lint`, `npm run format:check`. ESLint enforces
   **`react-hooks/set-state-in-effect`** — never call `setState` synchronously in
   a `useEffect` body (set state in async continuations; see
   `components/ui/AnimatedNumber.tsx`).
4. Secrets via env only (see §5). Work in small PRs; keep `main` deployable.

## 5. Environment variables

| Variable | Scope | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes | Supabase API base (`https://api.fundexecs.com`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | yes | Browser/SSR auth key (RLS-bounded) |
| `NEXT_PUBLIC_SITE_URL` | public | yes | Canonical origin for auth redirects |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes | Privileged server writes (bypasses RLS) |
| `ANTHROPIC_API_KEY` | server | yes | Claude (Earn + Proof-of-Truth) |
| `VOYAGE_API_KEY` | server | yes (RAG) | Embeddings for the 15 brains |
| `EARN_MODEL` | server | optional | Model override (default `claude-sonnet-4-6`) |

`VERCEL_URL` / `NEXT_PUBLIC_VERCEL_URL` are auto-injected by Vercel.

## 6. Acceptance (beta-ready)

For **each** of the 5 member types: create an account → complete Proof-of-Truth
onboarding (using Earn's recommend → approve flow) → land on the personalized
dashboard (alive with seed data) → create/advance a deal or objective → see the
Chain-of-Trust drawer and XP update → ask Earn a question and get a grounded
answer → repeat on a mobile viewport. Every screen shows sensible loading /
empty / error states; no action dead-ends. CI green on every PR; production
deploys from `main`.
