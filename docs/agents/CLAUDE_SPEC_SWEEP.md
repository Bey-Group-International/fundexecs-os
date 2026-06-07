# Claude — Full-stack spec sweep: wording + layout integrity (desktop / tablet / mobile / app)

**Goal.** A cross-breakpoint QA + polish pass so every authenticated and public
surface reads clean and sits right — **no margin/padding bleed, no overlay
bleed-through, no overflow, no copy slips** — at desktop, tablet, mobile, and the
installed/PWA app shell. UI polish only; no behavior or data changes.

## Breakpoints to audit

- **Desktop** ≥1280 (and ~1024 lg boundary)
- **Tablet** ~768
- **Mobile** 390×844 (iPhone 12/13 mini) — including safe-area insets
- **App shell** — the authed `AppShell`/`AuthedShell` chrome (rail, top-nav,
  drawers, wallet popover) at each width, and the off-canvas drawer on mobile

## Routes to walk

All authed surfaces + public: `/command-center`, `/profile`, `/trust`, `/audit`,
`/pipeline`, `/capital-stack`, `/match-inbox`, `/partners`, `/objections`,
`/deal-desk`, `/ic-memos`, `/governance`, `/knowledge`, `/materials`,
`/inbox-intelligence`, `/strategy`, `/connections`, `/notifications`, `/settings`,
`/ask-earn`, `/diligence`, `/lp-room`, plus `/`, `/login`, `/privacy`, `/terms`,
`/onboarding`.

## What to fix

### Layout integrity (the "bleed" class of bugs)

- **Margin/padding bleed:** inconsistent or doubled gutters, content kissing edges,
  cards whose padding doesn't match the section rhythm.
- **Overlay bleed-through:** drawers, popovers, modals, the Earn dock, and dropdowns
  must sit on **solid `bg-bg-1`** with proper z-index — no text showing through.
- **Horizontal overflow:** `scrollWidth === clientWidth` at every breakpoint; catch
  wide tables (Capital Stack), the agent strip scroller, long badges, code/URLs.
- **Truncation & wrapping:** long org/fund/person names, headlines, and rationale
  text truncate or wrap gracefully (no clipped descenders, no 1px jitter).
- **Mobile safe area:** respect `env(safe-area-inset-*)` on the shell and any fixed
  elements; sticky headers/footers don't cover content.
- **Active/hover/focus states** render correctly across breakpoints (no stuck hover
  on touch).

### Wording / copy

- Voice consistency: "**Chief Operating Officer · your live AI guide**",
  "**on the record / audit-ready / documented as it forms**"; **"copilot" is
  retired** — flag any stragglers. Earn is COO.
- Typos, casing, and label consistency (Title Case vs sentence case per pattern);
  empty-state and error copy reads calm and on-brand.
- The 15 specialist names/positions match `lib/team/roster.ts` exactly wherever
  shown.

## Method

- Prefer Playwright (already in the repo) to drive each route at the four widths
  and assert `scrollWidth === clientWidth`; capture before/after screenshots.
- Fix with **tokens-only** styling (no hardcoded hex); reuse existing spacing
  scale. Don't restructure components — this is polish, not a refactor.

## Guardrails

- **UI polish only:** no `lib/queries`/`lib/supabase`/`proxy.ts`/middleware/
  `app/login`/migrations/server-action changes; no new deps.
- Tokens-only; keep the 15 slugs; Admin stays in Settings; no lockfiles, no
  auth-bypass files.

## Deliverable

- A **before/after checklist** per breakpoint (pass/fail table per route) +
  representative screenshots.
- Branch `claude/spec-sweep`, **draft PR**, CI green
  (`format:check && typecheck && lint && build`), stop for review.
