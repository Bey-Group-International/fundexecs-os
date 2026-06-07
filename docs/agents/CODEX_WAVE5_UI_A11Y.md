# Codex — Wave 5 (UI): accessibility + mobile-responsive sweep

**Context.** The original a11y/mobile lane (SuperNinja) never delivered, so this
bounded **UI** sweep is reassigned to Codex. The dashboard refresh (#95) and the
module UIs (#93) are now merged to `main`, so the surface to harden is stable:
`/command-center`, `/capital-stack`, `/audit`, `/partners`, `/match-inbox`, plus
the shell (rail, top-nav, drawers, wallet popover).

> Lane note: this is **UI-only**, not your usual backend/data lane. Same
> discipline applies — touch only presentational code.

## Lane & guardrails (UI sweep)

- **UI-only.** Do **not** touch `lib/supabase/*`, `proxy.ts`, middleware,
  `app/login/*`, `lib/queries/auth`, `lib/ai/*`, or any migration. No new DB
  tables, no auth changes, no server-action behavior changes.
- **Tokens-only** styling — no hardcoded hex. Solid `bg-bg-1` overlays; reuse
  `--cta-gradient` / `--shadow-cta`. The **fg-5/fg-4 ramp is intentionally
  collapsed for AA contrast — do not "restore" it.**
- Keep the **15 brain slugs** stable. **Admin stays in Settings** (not the rail).
- **No `yarn.lock`, no `pnpm-lock.yaml`/`pnpm-workspace.yaml`** — this repo is
  **npm**. No `memory/*`, no auth-bypass files.
- Branch off **latest `main`**, **draft PR**, CI green, stop for Claude review.

## Part A — Accessibility (WCAG-AA)

Run `@axe-core/cli` (or `axe` via Playwright) across the key routes and fix
violations. Focus areas:

- **Labels & roles:** every icon-only button needs an `aria-label`; form inputs
  need associated labels; landmarks (`main`, `nav`) are present and unique.
- **Contrast:** meet AA (4.5:1 text / 3:1 large). The token ramp already targets
  this — fix any one-off `text-fg-5`/badge combos that fall short _without_
  editing the token definitions.
- **Focus order & visibility:** logical tab order; visible focus ring on all
  interactive elements (buttons, links, the new inline-action controls).
- **Keyboard:** the wallet popover, drawers, dialogs, and the Match Inbox
  accept/dismiss + Daily Command check-off controls must be fully operable and
  dismissible by keyboard (Esc closes overlays; focus is trapped then restored).
- **Alt text / aria-hidden:** decorative glyphs `aria-hidden`; meaningful images
  get alt text. Sparklines/gauges need an `aria-label` summary.

Recently-added controls to verify (already have starter aria — confirm + extend):
`components/dashboard/{MajorAlertsCard,DailyCommandList,AgentTeamStrip,MomentumCard,EarnBriefingCard,SinceAwayBanner}.tsx`,
`components/shell/{WalletTopUpPopover,CreditWalletGauge}.tsx`, and the #93 module
views (`components/{capital-stack,audit,partners,match-inbox}/*`).

## Part B — Mobile-responsive sweep (390×844, iPhone 12/13 mini)

- **No horizontal overflow** on any route. Watch the dashboard's
  `AgentTeamStrip` (horizontal scroll is intended — confirm it doesn't push the
  page), the Capital Stack tables, and Match Inbox rows.
- **Tap targets ≥ 44×44px** for all buttons/links, including the alert-dismiss
  `×`, the daily check-off box, and filter tabs.
- **Shell on small screens:** the rail, top-nav, and drawers collapse/behave;
  the wallet popover fits the viewport; modals are scrollable.
- **Dashboard grids** reflow to single-column cleanly (the spotlight 3-col and
  the operate grid).

## Part C — `/partners` reconcile (light)

#93 shipped `/partners` (`PartnersView` over `service_providers` +
`capital_providers`). Confirm it matches the intended Partner Marketplace scope
(searchable directory, type filter, check-size for capital providers, capability
chips for service providers, tasteful empty state). Fix only a11y/mobile gaps —
no new data dependencies.

## Employ agents

Parallelize by route cluster — e.g. one sub-agent for the dashboard surfaces,
one for the module pages (`capital-stack`/`audit`/`partners`/`match-inbox`), one
for the shell (rail/nav/drawers/wallet). Reconcile into a **single draft PR** so
Claude reviews once.

## Deliver

- A **before/after checklist**: axe violation counts per route (before → after),
  and a mobile pass/fail table at 390×844.
- CI green: `npm run format:check && npm run typecheck && npm run lint && npm run build`.
- Branch `codex/wave5-ui-a11y`, **draft PR**, stop for Claude review. Do not
  merge.
