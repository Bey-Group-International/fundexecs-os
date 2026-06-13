# Full-stack review — FundExecs OS

_Date: 2026-06-13 · Scope: architecture & code quality, performance · Stack:
Next.js 16 (App Router) · Supabase · Tailwind v4 · `motion@12`._

This review covers the two areas requested (architecture/code-quality and
performance). Security, accessibility, and data-layer audits were out of
scope for this pass. Findings are grouped by area with severity and
`file:line` references. The **Quick wins applied** section lists what was
fixed in this branch; **Recommended follow-ups** lists items that need a
product/owner decision before acting.

---

## Summary

The codebase is in strong shape. Standout strengths:

- **RLS-first data access** — auth checks precede any admin-client use; the
  server/admin Supabase split is enforced at import time with `server-only`.
- **Never-block AI patterns** — trust validation, profile suggestions, and
  Earn chat all degrade gracefully when the model is unavailable.
- **A genuinely governed motion system** — `docs/MOTION.md` + the `fx-*`
  tokens in `app/globals.css`, with a complete reduced-motion tiering layer.
  This is rare and worth protecting.
- **No XSS vectors** — no `dangerouslySetInnerHTML`; `NEXT_PUBLIC_` is used
  only for genuinely public values.

The primary debt is (1) **doc↔code drift** — the docs describe several files
and components that did not exist, and (2) **client-bundle / component-size**
hygiene on a handful of large `'use client'` surfaces.

---

## Architecture & code quality

### High

- **Doc↔code drift: motion JS twins were missing.** `docs/MOTION.md`
  documented `components/dashboard/command/motion.ts` (`MOTION_EASING`,
  `MOTION_DURATIONS_S`, `FX_SPRING`, `fxStagger`, `fxRiseItem`, `fxCollapse`,
  `fxPressable`) and a `<MotionConfig reducedMotion="user">` in
  `DashboardShell`. None of these existed; the one real `motion/react`
  consumer (`EarnOrb`) hardcoded `duration: 4.5` / `ease: 'easeInOut'`.
  **→ Fixed in this branch.**
- **Doc↔code drift: README dashboard layouts don't exist.**
  `README.md:24-33` documents five layout files (`InvestmentFirmLayout.tsx`,
  `IndividualInvestorLayout.tsx`, `StartupLayout.tsx`,
  `ServiceProviderLayout.tsx`, `StudentLayout.tsx`) and
  `MemberDashboardChrome`. The dashboard is actually one dynamic
  `app/(shell)/command-center/page.tsx`. Either the README is stale or the
  per-member layouts are planned work — needs an owner decision (see
  follow-ups).
- **Monolithic client component.** `components/earn/EarnDock.tsx` (~670 lines)
  couples streaming HTTP, message persistence, tasklet loading, focus
  management, and rendering in one `'use client'` file. Split into
  `EarnChat` / `EarnStream` / `EarnCommands` for testability.

### Medium

- **Unsafe casts in the trust flow.** `lib/actions/trust.ts:168-174` casts
  query rows (`(l as { layer_name: string })`) without runtime guards;
  `:379` builds a possibly-null `actorRow` then leans on truthiness only.
  Prefer explicit `select('col, col2')` + narrow types.
- **`select('*')` in several queries.** e.g. `lib/queries/member-profile.ts:38`
  and ~6 others. RLS-protected, but a new sensitive column would be exposed
  without code review. List required fields explicitly.
- **Error stacks shipped to logs.** `lib/observability/log.ts:26` serializes
  `error.stack`, leaking absolute paths/internal structure into
  logs/Sentry. Filter in production.
- **Inconsistent logging.** `lib/actions/member-profile.ts:122,126` use raw
  `console.warn` instead of the structured `log.warn` used elsewhere.
- **Swallowed errors.** `lib/actions/trust.ts:334` uses `.catch(() => undefined)`,
  hiding real failures. Log the error instead.
- **No segment error boundary.** There is no `app/(shell)/error.tsx`; only
  the root boundary catches hub failures, so Build/Source/Run/Execute errors
  fall back to a generic screen.

### Low

- **Large inline-composed pages.** `app/(shell)/command-center/page.tsx` and
  `components/shell/AppShell.tsx` define several sub-components inline; extract
  for readability and unit testing.

---

## Performance

### High

- **`EarnOrb` is `'use client'` on every authenticated page.**
  `components/earn/EarnOrb.tsx` ships `motion/react` + `EarnCoin` into the
  shell bundle globally. It's a small float animation — acceptable, but it's
  the one always-present client island, so keep it lean.
  (Now uses shared tokens; see quick wins.)
- **Per-surface lucide icon fan-out.** `GovernanceFlow.tsx` imports 31 icons,
  `FormationFlow.tsx`/`BrandStudioFlow.tsx` ~27 each, and
  `components/ui/MandateIcon.tsx` builds a 43-icon lookup map. Tree-shakes,
  but the cumulative per-chunk cost is high on these large client surfaces.

### Medium

- **`earn-coin.png` is 731 KB.** `public/earn-coin.png` is the brand mark
  rendered across the shell. Convert to WebP/AVIF and target <100 KB.
- **No explicit Next 16 caching strategy.** Queries use request-level
  `cache()` (good for dedupe within a request) but there are no `'use cache'`
  / `cacheLife` / `revalidate` directives on high-traffic routes
  (command-center, build/source/run/execute). Each new session re-fetches
  mandate/identity/rail.
- **`getLifecycleRail` called twice per shell→hub path.** Once in
  `app/(shell)/layout.tsx`, again in each hub `layout.tsx`. Request-cache
  dedupes it, but the duplicated call sites are a maintenance trap.
- **Unbounded warm-relationship query.** `lib/queries/command-center.ts`
  (~75-115) fetches all warm relationships in the last 7 days with no
  `LIMIT`. Add a cap/pagination before org sizes grow.

### Low (verify before acting)

- **Unused dependencies.** `qrcode` and `react-markdown` have no first-party
  imports in `app/`, `components/`, `lib/`, or scripts. Confirm no
  feature-gating, then remove from `package.json`.
- **Animation discipline is otherwise excellent** — all `fx-*` keyframes are
  transform/opacity/`background-position` only, infinite loops pause via
  `data-in-view`, and every meaningful class has a reduced-motion twin.

---

## Quick wins applied in this branch

These were low-risk, high-confidence fixes (typecheck, lint, 447 unit tests,
and `next build` all green):

1. **Recreated the missing motion foundation** —
   `components/dashboard/command/motion.ts` now exports the documented
   `MOTION_EASING`, `MOTION_DURATIONS_S`, `FX_SPRING`, `fxStagger`,
   `fxRiseItem`, `fxCollapse`, `fxPressable`, exactly matching the CSS tokens.
2. **`EarnOrb` now reads tokens** instead of hardcoded `4.5` / `'easeInOut'`.
3. **Added `<MotionConfig reducedMotion="user">` to `AppShell`** so all
   `motion/react` animations under the shell honor OS reduced-motion, as the
   docs already claimed.
4. **Fixed `docs/MOTION.md` drift** — `DashboardShell` → `AppShell`, and
   documented the new reusable consumers.

See the **Animation** changelog below for the value-add motion shipped on top
of this foundation.

## Recommended follow-ups (need a decision)

- **README dashboard layouts**: implement the five per-member layouts, or
  prune the README section. (Product call.)
- **Refactor `EarnDock`** into composable pieces.
- **Add Next 16 caching** to high-traffic authenticated routes.
- **Optimize `earn-coin.png`** to WebP/AVIF.
- **Remove `qrcode` / `react-markdown`** once confirmed unused.
- **Tighten trust-flow casts and logging** (`lib/actions/trust.ts`,
  `lib/observability/log.ts`).

---

## Animation changelog (this branch)

Motion added strictly within the `docs/MOTION.md` bar — each effect names a
state change, is transform/opacity-led, and is reduced-motion safe.

- **Command Center KPIs** (`components/command-center/CommandCenterKpis.tsx`):
  the four desk figures now count up on first view via the new
  `AnimatedNumber` (`components/ui/AnimatedNumber.tsx`, tabular figures,
  `IntersectionObserver`-gated, final value at first paint) and arrive in a
  short stagger. tier: meaningful — the numbers read as live.
- **Reusable primitives** (`components/dashboard/command/MotionReveal.tsx`):
  `MotionStagger` + `MotionItem` (group cascade) and `Reveal` (single
  scroll-reveal), all self-guarding `useReducedMotion()`.
- **Landing** (`app/page.tsx`): the six post-hero sections rise + fade once as
  they scroll into view (`Reveal`). Landing-tier cinematic permission; these
  are entrances, not ambient loops, so they don't compete for attention.
