# FundExecs OS — PRD

Next.js 16 App Router + Supabase (Auth / Postgres / pgvector / Storage)

- Tailwind v4. A private-markets operating system with a 15-AI
  specialist team (Earn is COO; "copilot" wording retired). Deployed on
  Vercel.

## Phase status (working beta)

| phase   | scope                                                                                                                                | status             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Phase 1 | §3H Team identity carry-over                                                                                                         | ✅ DONE            |
| Phase 2 | Deliverable D — 5 member-type dashboard layouts                                                                                      | ✅ DONE            |
| Phase 3 | Foundational + runtime: middleware gate, /api/ask-earn never-block, signup seed + per-type top-up migration, 5 live test users       | ✅ DONE 2026-02-06 |
| Phase 4 | Core-loop persistence A–E: server actions across Pipeline / Connections / Strategy / Notifications / Admin                           | ✅ DONE 2026-02-07 |
| Phase 4 | Deliverable F (Settings) — handled by external Codex bot, merged to `main`                                                           | ✅ DONE (external) |
| Phase 5 | Chain of Trust end-to-end: migration + Storage bucket, server actions, AI validation, DB-driven drawer + dashboard wiring (A–E)      | ✅ DONE 2026-02-07 |
| Phase 5 | Fix — never-block AI validation writes placeholder on all failure paths (Test 2 regression)                                          | ✅ DONE 2026-02-07 |
| Phase 6 | Mocked integrations + real-OAuth path for Slack / Calendly                                                                           | ⏳ Codex (own PR)  |
| Phase 7 | Polish + release prep — type augmentation, dead-end / empty / error audit, mobile 390×844 sweep, a11y sweep, README + memory updates | ✅ DONE 2026-02-07 |

## Phase 7 deliverables (this sprint)

### 7-A — Type augmentation + cast cleanup

- Live-DB introspection (`scripts/introspect-schema.cjs`) found the
  columns Phase 4/5 added on `evidence`, `notifications`, and
  `org_members`.
- Augmented `lib/supabase/database.types.ts` additively — no other
  tables touched. Full CLI regen deferred until a `SUPABASE_ACCESS_TOKEN`
  is available (post-sprint cleanup).
- Swept `as never` and `as unknown as` casts in `lib/actions`,
  `lib/queries`, `lib/ai`: **23 → 3**. Each remaining cast carries an
  inline comment explaining why it cannot be removed (RPC name not yet
  in types; PostgREST nested-join flattening).

### 7-B — Loading / empty / error / dead-end audit

- `grep -rn 'onClick={() => {}}'` returns 0 dead-end buttons across
  `app/` and `components/`.
- Every authed surface (command-center, pipeline, connections,
  strategy, notifications, admin, ask-earn) renders a tasteful empty
  card with a CTA when the relevant table is empty.
- Loading state: root `app/loading.tsx` covers all routes with a
  spinner skeleton.
- Error state: command-center has per-layout inline error cards; the
  list-view pages bubble up to the root `app/error.tsx` calm
  "Something went wrong / Try again" card.
- Retired the static `Atlas Manufacturing` placeholder in
  `app/admin/AdminView.tsx`'s TrustPanel — replaced with an empty state
  that links to /command-center and /pipeline where real Chain-of-Trust
  records live.

### 7-C — Mobile responsiveness (390×844)

All 7 authed surfaces pass: `scrollWidth = clientWidth = 390` (delta 0).

### 7-D — Accessibility sweep (axe-core 4.10)

- `--fg-4` token nudged from slate-500 (#64748b) to #7a899e in dark
  mode (~5.4:1 vs bg-0). Cleared 5 of 7 contrast nodes per page.
- `<ProgressBar>` primitive grows an optional `ariaLabel` prop. Every
  call site now passes a descriptive label.
- Decorative AppShell chrome (⌘K hint, 8px "Earn coins" subtitle)
  gets `aria-hidden="true"` — not exposed to assistive tech.
- The Ask Earn input + evidence-upload file input gain `aria-label`s.
- Lighthouse a11y on `/login`: **95**. Authed axe baseline: 1
  remaining violation (color-contrast on aria-hidden decorative
  chrome, 2 nodes), 41–42 passes.

### 7-E — README + memory updates

- `README.md` rewritten to onboard a new contributor in under 30
  minutes: member types, Chain-of-Trust flow, integration adapter
  pattern, local setup, env vars, test users, code map, invariants.
- `/app/memory/PRD.md` (this file): Phase 1–7 status table.
- `/app/memory/test_credentials.md`: refreshed after the password
  re-application; the provisioning script now idempotently re-applies
  the canonical password on every run.

## Branches

- `phase4-core-loop`: Phase 4 A–E + Codex F spec doc. Push to
  `emergent/phase4-core-loop` is **parked** on the user's side (pod
  CLI is read-only; user pushes via Emergent's "Save to GitHub").
- `phase5-chain-of-trust`: Phase 5 A–E + Test-2 fix. 6 commits delta
  vs `phase4-core-loop`.
- `phase6-integrations` _(Codex)_: in flight; pod must NOT touch
  `lib/integrations/`, `app/api/integrations/`, `app/integrations/`,
  `lib/actions/integrations.ts`, or `components/integrations/`.
- `phase7-polish` _(this branch)_: 7 commits delta vs
  `phase5-chain-of-trust`.

## Backlog / post-sprint

- Full `database.types.ts` regen via `npx supabase gen types
typescript --project-id …` once a `SUPABASE_ACCESS_TOKEN` is
  available.
- Re-embed the brains corpus after Phase 6 lands (Voyage API).
- Migrate Anthropic SDK to the v1 streaming API when 5.x lands stable.
- Per-route `loading.tsx` + `error.tsx` per surface (currently root-
  level only).

## Invariants

- "Copilot" is retired.
- `lib/team/*` is the single source of truth for the 15 specialists.
- All Supabase secrets read from `process.env`; never inlined.
- CI green: `yarn format:check && yarn build && yarn typecheck && yarn lint`.
- Migrations are additive + idempotent. No drops.
- Brain slugs frozen.
- AI calls are **never-block**: missing key / timeout / API failure
  must degrade gracefully and never block an approval path.
