# Emergent — Wave 1 brief (Shell: rail + Dashboard + Fund Profile)

> Paste to Emergent. Read `docs/PRIVATE_MARKET_LIFECYCLE.md` first (the program
> spec). The prototype is the **visual + functional reference**; we port its IA
> and dashboard onto the live Next.js + Supabase stack — we do NOT import the
> bundle.

## Who you are

Net-new UI lane. Claude owns data/logic/Earn + review; Codex owns new data.
Build UI against Claude's typed loaders with placeholder fallback.

## Hard rules

- Branch `emergent/wave1-shell` off the **LATEST `main`** (do not reuse the stale
  `emergent/work` base). Draft PR. CI green (`format:check`, `typecheck`, `lint`,
  `build`). Stop at the checkpoint for review.
- **Do NOT touch** auth (`lib/supabase/*`, `proxy.ts`, `app/login/*`,
  `lib/queries/auth.ts`), middleware, or migrations. **UI only.**
- Design tokens in `app/globals.css` + `@/components/ui` only — no inline hex.
  Overlays/drawers use solid `bg-bg-1` (the translucent bug is fixed; don't
  reintroduce it). Keep the 15 brain slugs stable.

## Build

### 1. Unified 6-area side rail (the canonical IA)

Replace the current rail with ONE rail grouping nav by the six logic areas from
the spec:

- **Source of Truth:** Fund Profile · Trust Center
- **Daily Execution:** Dashboard · Action Queue · Match Inbox
- **Capital Formation:** LP Pipeline · Capital Stack · Objections
- **Deal Execution:** Deal Desk · IC Memos · Governance
- **Intelligence:** Inbox Intelligence · Knowledge Base · Capital Materials · Partner Marketplace
- **Audit:** Trust Center · Memory Audit Trail

Keep existing live routes wired (`/command-center`, `/pipeline`, `/connections`,
`/diligence`, `/integrations`, `/strategy`, `/notifications`, `/settings`); for
not-yet-built modules, route to a tasteful "coming in this sprint" placeholder
page (clearly stubbed, not a dead link). Persist **Fund Profile** in the rail.

### 2. Dashboard — BlackRock-style command center (MIMIC THE PROTOTYPE, high fidelity)

Frame: a **command center for a private-market operator, co-piloted by a 15-AI-
agent executive team that works with the manager and keeps working via
automations even when they're away.** Replicate the prototype's dashboard
**layout, section ordering, card structure, and interactions as closely as
possible**, re-skinned to our tokens, bound to real data via Claude's loader.
Required surfaces (compose into the prototype's layout):

- **Major Alerts** — the few high-priority items needing attention now.
- **Execution Score** — front-facing **Chain of Trust** score with the
  **gamification** (XP, level, streak, layer-completion %) surfaced to _drive
  execution & completion_ (reuse `ChainOfTrustStrip`).
- **Fund Readiness** — front-facing readiness score **with its related functions
  shown next to it** (the dimensions that make up readiness, each actionable).
- **Next Best Action** — the single highest-priority recommended move (reuse
  `EarnNextBestActions`).
- **Daily Command** — today's prioritized action list (the daily operating loop).
- **Activity Feed** — recent activity incl. **work the AI team did autonomously**.

Per-member-type variants build on the existing `app/command-center/layouts/*`.

### 3. Fund Profile (Source of Truth)

A dedicated surface + a compact rail summary: thesis, strategy, target raise,
terms, track record, team, and a **completeness/credibility score** (from
Claude's loader). Read-mostly this wave; edit affordances can be stubbed.

### 4. Settings — vertical detail rail (infused details baked in)

Settings as a **vertical side rail** (not a flat page of links): each section
(profile, org, integrations, notifications, billing/wallet, security) expands
with its details inline in the rail. Reuse existing `/settings` data. UI only;
match the prototype's settings interaction if present.

### 5. Credit Wallet — top nav (billing wired in)

A **credit wallet indicator in the top nav** showing the org's credit balance,
with a popover for usage + top-up. Wire it to Claude's `getCreditWallet(orgId)`
loader + the top-up action (Stripe connect is a later step — render test/stub
state cleanly when unconfigured). Credits are consumed by AI-agent work
(diligence runs, Earn, the 15-agent team); show recent consumption.

## Data contract (Claude provides; bind to these, with placeholder fallback)

- `getDashboardData(orgId)` → `{ stage, readinessScore, readinessBreakdown,
executionScore (chain-of-trust + xp/level/streak), majorAlerts[],
nextBestAction, dailyCommand[], activityFeed[], raiseProgress, stageKpis[] }`.
- `getFundProfile(orgId)` → profile fields + completeness score + gap list.
- `getCreditWallet(orgId)` → `{ balance, currency, recentConsumption[], plan }`.
  (Types land in `lib/queries/dashboard.ts` / `fund-profile.ts` / `credit-wallet.ts`.)

## 🛑 STOP-AND-SAVE CHECKPOINT

When the rail + Dashboard (mimicking the prototype) + Fund Profile render from
loaders/placeholders: CI green → push `emergent/wave1-shell` → open a **draft
PR** → list the prop/type contracts + screenshots → **STOP** for Claude review.
Do not wire backend, touch auth, merge, or start Wave 2.
