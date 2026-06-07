# Claude — Side Rail refinement: intentional compartmentalization

**Context.** The authenticated side rail (`components/shell/Wave1SideRail.tsx`) is
organized into **6 logic-area compartments** — Source of Truth · Daily Execution
· Capital Formation · Deal Execution · Intelligence · Audit — with lifecycle-stage
emphasis (`STAGE_TO_GROUP_KEYS`), per-item signal badges, and `live`/`soon` flags.
This is a **functional + visual refinement** to make the compartmentalization
deliberate. Scope is **rail UI + a nav registry only** — no route/page/loader/
middleware/migration changes.

## Goal

Each of the 6 areas reads as an **intentional compartment**: a labeled, bordered
section that **collapses**, with the **stage-relevant area auto-expanded** and the
rest collapsed to a header that still signals state. The rail becomes an attention
router, not a flat link list.

## Requirements

### A. Compartment behavior (collapsible, active auto-expands)

- Each area group becomes a **collapsible section** (accordion-style, but multiple
  may be open). Header is a real `<button>` with `aria-expanded` + `aria-controls`;
  the panel has a matching `id`. Chevron rotates; reduced-motion-safe.
- **Auto-expand logic on load:** open (1) the group containing the **active route**,
  and (2) the group(s) the **current lifecycle stage** emphasizes
  (`STAGE_TO_GROUP_KEYS`). Collapse the rest.
- **Persist** the user's manual expand/collapse per group across navigations via a
  lightweight cookie or `localStorage` (UX-only; never gates data). Manual override
  wins over auto-expand once the user has toggled a group.
- A **collapsed** group still shows its **rollup badge** (see B) so state isn't
  hidden.

### B. Visual treatments (all four)

- **Section cards + dividers:** render each compartment as a bordered/spaced block
  (`bg-bg-1`, hairline border) so boundaries read as deliberate.
- **Per-group rollup badge:** a small count on each area header = the **sum of the
  existing per-item `signals.badges`** for that group's items (computed in the rail
  — **no loader change**). Tone follows the highest-severity child badge.
- **Group header icons + hierarchy:** give each area a header `LucideIcon`
  (Source of Truth → `ShieldCheck`, Daily Execution → `LayoutDashboard`, Capital
  Formation → `TrendingUp`, Deal Execution → `Briefcase`, Intelligence → `Mail`,
  Audit → `History`) + a refined type ramp so the 6 areas scan instantly.
- **Density + active-state polish:** tune spacing, the active gradient + left
  indicator, hover motion (`hover:translate-x-0.5`), and visible focus rings.

### C. Functional fixes (all four)

1. **Single nav registry as source of truth.** Extract the groups + items + `live`
   flags out of the component into one registry module (e.g.
   `components/shell/rail-nav.ts`). Fix the **stale flags**: `match-inbox`,
   `capital-stack`, `partners`, `audit` are **live** (shipped #93/#95/#98);
   `objections` + `materials` stay `soon`; `inbox-intelligence` stays `soon` until
   its UI ships. The component renders from the registry only.
2. **De-dupe Trust Center.** It currently appears in both _Source of Truth_ and
   _Audit_. Keep it in **Source of Truth**; _Audit_ keeps only **Memory Audit Trail**
   (`/audit`).
3. **Stage-aware auto-focus.** On load, auto-expand (and scroll into view if needed)
   the compartment owning `signals.currentStage` (per A).
4. **Wire more live badges.** Render per-item badges for every `href` present in
   `signals.badges` (already provided by `buildRailSignals`); the rollup (B) derives
   from these. If a desirable count isn't emitted today, **leave a TODO** — do not
   expand the loader (out of scope).

## Guardrails

- **UI-only:** touch `components/shell/Wave1SideRail.tsx` + the new
  `components/shell/rail-nav.ts` (+ a tiny client persistence helper if needed).
  **No** `lib/queries/*`, `lib/supabase/*`, `proxy.ts`, middleware, `app/login/*`,
  migrations, or route/page files. Don't change `buildRailSignals`.
- Keep the existing **public props** of `Wave1SideRail` stable (AppShell/AuthedShell
  mount it) — `pathname`, `open`, `onClose`, `identity`, `signals`,
  `sourceOfTruthSummary`, `onSignOut`. The `sourceOfTruthSummary` slot stays on the
  Source-of-Truth group.
- **Admin stays in Settings** (not the rail). Keep the org switcher + user footer.
- Tokens-only styling; solid `bg-bg-1`; no hardcoded hex; reuse existing tokens
  (`--azure-soft`, hairline, gold for emphasis only).
- **a11y:** accordion headers keyboard-operable (Enter/Space), `aria-expanded`/
  `aria-controls`, focus rings, roving order intact. **Mobile:** the off-canvas
  drawer behavior at `<lg` is preserved; links still call `onClose`.
- Reduced-motion: chevron/expand animations respect `prefers-reduced-motion`
  (reuse the globals pattern). No lockfiles, no auth-bypass files.

## Deliverables

- Refactored `Wave1SideRail.tsx` (collapsible compartments + visual treatments).
- New `components/shell/rail-nav.ts` (groups, items, live flags, group icons,
  `STAGE_TO_GROUP_KEYS`) as the single source of truth.
- Collapse-state persistence helper (cookie/localStorage).
- A short before/after note + an a11y check of the accordion.
- Branch `claude/side-rail-refine`, **draft PR**, CI green
  (`format:check && typecheck && lint && build`), stop for review.
