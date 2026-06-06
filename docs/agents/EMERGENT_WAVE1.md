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

### 2. Dashboard — MIMIC THE PROTOTYPE (high fidelity)

Replicate the prototype's dashboard **layout, section ordering, card structure,
and interactions as closely as possible**, re-skinned to our tokens and bound to
real data via Claude's loader. Keep the existing `ChainOfTrustStrip` +
`EarnNextBestActions`. The dashboard is **lifecycle-aware** (per spec): the
hero/KPIs reflect the manager's current stage + readiness score. Per-member-type
variants build on the existing `app/command-center/layouts/*`.

### 3. Fund Profile (Source of Truth)

A dedicated surface + a compact rail summary: thesis, strategy, target raise,
terms, track record, team, and a **completeness/credibility score** (from
Claude's loader). Read-mostly this wave; edit affordances can be stubbed.

## Data contract (Claude provides; bind to these, with placeholder fallback)

- `getDashboardData(orgId)` → lifecycle stage, readiness score, stage KPIs, top
  actions, raise progress.
- `getFundProfile(orgId)` → profile fields + completeness score + gap list.
  (Exact types land in `lib/queries/dashboard.ts` / `lib/queries/fund-profile.ts`.)

## 🛑 STOP-AND-SAVE CHECKPOINT

When the rail + Dashboard (mimicking the prototype) + Fund Profile render from
loaders/placeholders: CI green → push `emergent/wave1-shell` → open a **draft
PR** → list the prop/type contracts + screenshots → **STOP** for Claude review.
Do not wire backend, touch auth, merge, or start Wave 2.
