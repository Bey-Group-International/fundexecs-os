# Release Sweep — Private Beta

Goal: get FundExecs OS to **private-beta** quality. Beta-free credits (wallet +
consume/refund already live) **with an active Stripe top-up path**. Build the
not-yet-built modules **in parallel where feasible**; keep polished "coming soon"
only where we can't finish in time. Core flows (diligence, pipeline, LP Room,
Fund Profile, dashboard) are the beta value and are already live.

## Shared guardrails (ALL agents)

- Branch off **latest `main`**; **draft PR**; CI green (`format:check`, `typecheck`,
  `lint`, `build`). Stop at the PR for Claude review. Squash-merge by Claude.
- **Lanes:** SuperNinja + Manus = **UI** (no `lib/supabase`, `proxy.ts`,
  middleware, `app/login/*`, `lib/queries/auth`, `lib/ai/*`, migrations). Codex =
  **backend/data** (migrations additive+idempotent, RLS, advisor-clean; can't
  apply — Claude applies). Claude = observability, AI, sensitive, review.
- Tokens-only styling; solid `bg-bg-1` overlays; reuse `--cta-gradient`/`--shadow-cta`.
  Keep the **15 brain slugs** stable. **Admin stays in Settings** (not the rail).
  No `yarn.lock`, no `memory/*`, no auth-bypass files. Bind UI to existing typed
  loaders with placeholder fallback.

## Lane 1 — SuperNinja (≈300 cr · bounded UI)

**Accessibility + mobile-responsive sweep.**

- Run `@axe-core/cli` across key routes; fix WCAG-AA issues (labels, roles,
  contrast, focus order, alt text). The fg-5/fg-4 ramp is intentionally collapsed
  for AA — don't undo.
- Mobile sweep at 390×844: no horizontal overflow, tap targets ≥44px, the rail +
  top-nav + drawers behave on small screens. Report a before/after checklist.

## Lane 2 — Manus (≈1300 cr · broad UI + module surfaces)

**A) Release hygiene:** `app/robots.ts` + `app/sitemap.ts`; metadata/OG for the 9
routes missing it; per-route `error.tsx` + `loading.tsx` + tasteful empty states
across surfaces; privacy/terms freshness pass.
**B) Build the from-existing-data module UIs** (bind to existing loaders; replace
their ComingSoon):

- **Capital Stack** (`/capital-stack`) — full UI over `capital_stack_summary`
  (stage + lp_type breakdown, gap-to-target, commitments table).
- **Memory / Audit Trail** (`/audit`) — timeline over `trust_events` +
  `admin_actions` + diligence findings (Claude provides a loader).
- **Partner Marketplace** (`/partners`) — directory over
  `service_providers`/`capital_providers`.
- **Match Inbox** (`/match-inbox`) — triage UI over `matches` (accept/dismiss via
  the `act_on_match` action Claude wires).
- **Stripe top-up UI** in the wallet popover (calls the checkout action Claude/
  Codex provide; render test state cleanly).
  Keep ComingSoon ONLY for `materials` + `inbox-intelligence` (deeper work).
  _(Partner Marketplace moved to Lane 5 — Emergent.)_

## Lane 5 — Emergent (≈150 cr · bounded UI)

**Partner Marketplace** (`/partners`) — replace the ComingSoon stub with a
directory UI over Claude's `getPartners(orgId)` loader (service providers +
capital providers, org-scoped). Cards/list with type, name, and a tasteful empty
state; bind to the typed loader with placeholder fallback. Self-contained, no
cross-agent dependency. Same shared guardrails (UI-only, tokens-only, solid
`bg-bg-1`, branch `emergent/partners`, draft PR, stop for Claude review).

## Lane 3 — Codex (pro · backend/data)

- **wave3** (already briefed): wallet-on-signup trigger, `generate_lp_matches`
  scoring (populate Match Inbox), Capital Stack backfill from allocations.
- **Objections** data model (`objections` table: per-LP objection + rebuttal +
  status) + RLS, so the Objections module can be built.
- **Stripe top-up backend:** `credit_purchases` ledger + a `record_topup` path
  (Claude wires the Stripe webhook/checkout server-side; Codex models the data).
- **Security hardening:** tighten the 4 `SECURITY DEFINER` advisor WARNs that are
  safe to change (audit call sites; leave `create_organization`/`seed_demo` which
  need authenticated execute); RLS spot-audit on the newest tables.

## Lane 4 — Claude (me)

- **Observability:** Sentry (`@sentry/nextjs`) + structured logging, DSN-from-env
  (graceful when absent). Error boundaries.
- **Critical-path e2e:** extend Playwright beyond smoke (auth happy-path w/ secret,
  diligence run, settings/admin gate, wallet).
- **Stripe top-up wiring** (server: checkout session + webhook → `grant_credits`),
  **`act_on_match`** server action, **Audit Trail loader**, **Objections logic**.
- **Ops:** rotate the temp staging password, env/readiness checklist.
- **Review/merge** all lanes; apply Codex migrations + regenerate types.

## Sequencing

Codex data (wave3 + objections + topup ledger) and SuperNinja/Manus UI run in
parallel off current `main`. Claude lands observability/e2e now, wires the
data→UI contracts (act_on_match, audit loader, Stripe) as Codex's data merges,
and reviews/merges everything. ComingSoon remains for `materials` +
`inbox-intelligence` this beta.
