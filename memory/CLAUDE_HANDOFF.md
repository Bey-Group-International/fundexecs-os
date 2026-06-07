# Wave-1 Finishing Pass — Handoff to Claude

**Branch:** `emergent/wave1-finish` cut from local `emergent/wave1-shell` HEAD `84cf553` (= functionally equivalent to "latest main" once the Wave-1 PR is merged on origin — pod has no `origin` remote so I couldn't fetch your actual main; if the SHAs differ on origin, a rebase should resolve cleanly because every commit on this branch is UI-only).

**Final HEAD:** `457fe50`
**Commits added by this cycle:** 3
**CI gate:** ✅ tsc · ✅ lint · ✅ format:check · ✅ build (all green at HEAD)
**Files touched this cycle:**

- `components/drawers/ContactDetailDrawer.tsx` (EarnContextProvider wrap)
- `components/shell/ComingSoonPage.tsx` (CTA copy)
- `components/shell/earn/EarnDock.tsx` (`inert` when closed)
- `app/globals.css` (`--fg-5` token lift, dark + light)
- `scripts/wave1-finish-mobile-sweep.cjs` (new)
- `scripts/wave1-finish-a11y-axe.cjs` (new)
- `package.json` + `yarn.lock` (axe-core + @axe-core/playwright as devDeps)

---

## Shipped this cycle

| Commit    | Scope                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `3d3576a` | **feat(ui): wave-1 finish — drawer wrap rollout + copy nudge** (ContactDetailDrawer kind='lp' + ComingSoonPage CTA = "Back to dashboard") |
| `e1761cf` | **chore(scripts):** mobile sweep at 390×844 — clean, zero horizontal overflow across all 5 surfaces                                       |
| `457fe50` | **fix(a11y): wave-1 finish axe pass — 0 violations on dashboard/profile/settings** (fg-5 token lift + EarnDock `inert`)                   |

**Per-item status against the original spec:**

| Spec item                                                               | Status     | Notes                                                                                                         |
| ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| Wrap `LpDetailDrawer.tsx`                                               | ⏸ N/A      | File doesn't exist in codebase — `ContactDetailDrawer.tsx` IS the LP relationship surface (wrapped instead).  |
| Wrap `ContactDetailDrawer.tsx` (kind: 'lp')                             | ✅ Shipped | EarnContextProvider with `entityId: contact.id`, `entityLabel: contact.fullName`.                             |
| Wrap `ObjectiveDrawer.tsx` (kind: 'objection')                          | ⏸ Skipped  | See "Not shipped" §1 below — semantic mismatch; deferred for your review.                                     |
| ComingSoonPage CTA copy "Back to dashboard"                             | ✅ Shipped | Default `backLabel` changed; no caller overrides.                                                             |
| Mobile sweep — `/command-center`, `/profile`, `/settings`, rail, topnav | ✅ Shipped | All 7 frames in `.screenshots/wave1-finish-mobile/`; `_findings.json` confirms 0 hOverflow on all 5 surfaces. |
| a11y axe pass — fix obvious wins                                        | ✅ Shipped | 2 violations × 3 surfaces = 6 findings, all fixed. Post-fix: 0 violations.                                    |
| CLAUDE_HANDOFF.md                                                       | ✅ Shipped | This file.                                                                                                    |

---

## Not shipped — pick up here

### 1. ObjectiveDrawer EarnContext wrap

- **Why deferred:** Spec said `ObjectiveDrawer.tsx → kind: 'objection'`, but after searching `components/drawers/` and grepping for `objection`, the codebase has:
  - `components/drawers/ObjectiveDrawer.tsx` — drawer for **strategic objectives** (100-day / 30-day / 10-day plans). Uses `lib/actions/strategy.createObjective`.
  - `app/objections/page.tsx` — **stub route** for the LP-objection Library (a Wave-1 placeholder, no drawer behind it yet).

  The two are semantically distinct: `objection` in `EarnContextCopy.ts` is for LP pushback ("Objections · turn pushback into commitments") — different concept from strategic objectives.

- **Concrete next steps:**
  1. Decide whether the `ObjectiveDrawer` should expose Earn quick-actions appropriate for the strategy module. If yes, add a new `EarnContextKind` value (e.g. `'strategy'` or `'objective'`) in `components/shell/earn/EarnContext.tsx` and a copy entry in `components/shell/earn/EarnContextCopy.ts` (subtitle: "Strategic objectives · the next 100 days", actions: "Sharpen this objective", "Tie to a deal", "Set the next checkpoint", etc.).
  2. Wrap `ObjectiveDrawer.tsx` body in `<EarnContextProvider value={{ kind: 'strategy', entityId: draft.id ?? 'new', entityLabel: draft.objective }}>` (or whichever kind you add).
  3. When the LP-objection drawer is eventually built for `/objections`, wrap it with `kind: 'objection'` (the existing context kind).

- **Files involved:** `components/drawers/ObjectiveDrawer.tsx`, `components/shell/earn/EarnContext.tsx`, `components/shell/earn/EarnContextCopy.ts`.

- **Suggested commit message:** `feat(ui): earn context for strategic objectives drawer`

- **Verification:** Open the drawer from `/strategy` and confirm the Earn dock subtitle switches; close it and confirm the dock falls back to the route default (`kind='dashboard'`).

### 2. Remaining drawer wraps for the entity-override pattern

- **Why deferred:** Out of scope for this cycle (P0 only covered ContactDetailDrawer + ObjectiveDrawer). The DealDetailDrawer was wrapped in Wave-1 Commit 3 as POC.

- **Concrete next steps:**
  1. `components/drawers/NewDealDrawer.tsx` → wrap with `kind: 'deal-desk'` (new-deal creation flow lives in the deal-desk loop).
  2. `components/drawers/NewPartnerDrawer.tsx` → wrap with `kind: 'partners'`.
  3. `components/drawers/EvidenceUploadForm.tsx` — not a drawer (form embed); skip.

- **Files involved:** `components/drawers/NewDealDrawer.tsx`, `components/drawers/NewPartnerDrawer.tsx`.

- **Suggested commit message:** `feat(ui): earn context wraps on new-deal + new-partner drawers`

- **Verification:** Open each drawer and confirm the dock subtitle / chips switch accordingly.

### 3. fg-5 token — full ramp restoration

- **Why deferred:** The a11y fix collapsed `--fg-5` into `--fg-4`'s value (same brightness band). That clears WCAG AA across all 70+ `text-fg-5` call sites without touching any of them, but visually the dimmest tier of the slate ramp disappears.

- **Concrete next steps (only if the design wants the 5-tier ramp back):**
  1. Audit which `text-fg-5` usages truly need the _dimmest_ tier vs. which were just decorative (status pills, eyebrow labels, hover hints).
  2. Pick a new `--fg-5` value that's brighter than the old `#475569` but slightly dimmer than `#7a899e` — e.g. `#828ea2` for dark / `#7a8395` for light — and re-verify contrast against `bg-0` is ≥ 4.5:1.
  3. Alternative: keep the collapsed token but introduce a dedicated `--fg-decoration` (~3:1) for state-only labels that don't need AA-level reading.

- **Files involved:** `app/globals.css` lines 36 / 96.

- **Suggested commit message:** `refactor(tokens): restore fg-5 dimmest tier with WCAG-passing value`

- **Verification:** Re-run `node --env-file=.env.local scripts/wave1-finish-a11y-axe.cjs` and confirm 0 violations stay.

### 4. Vercel deployment-protection bypass for tester

- **Why deferred:** The Wave-1 preview URL (`https://fundexecs-os-git-emergent-wave1-shell-bgi-pres-projects.vercel.app`) is gated behind Vercel team SSO (401 challenge). Your tester will need a bypass token.

- **Concrete next steps:**
  1. Vercel project settings → Deployment Protection → Bypass for Automation → Generate token.
  2. Pass the token to the tester as `?__vercel_protection_bypass=<token>` query param OR as the `x-vercel-protection-bypass` header on every request.

- **No code change needed.**

### 5. `vercel.json` branch-preview config

- **Why deferred:** Out of scope (tokens/config lane), and the 401 SSO response we saw suggests Vercel is still routing the branch deployment despite `"deploymentEnabled": { "main": true }`. Worth confirming on the dashboard.

- **Concrete next steps (if branch previews need to be enabled explicitly):**
  ```json
  // vercel.json
  {
    "git": {
      "deploymentEnabled": {
        "main": true,
        "emergent/wave1-shell": true,
        "emergent/wave1-finish": true
      }
    }
  }
  ```
  Or simpler: drop the `deploymentEnabled` block entirely to let Vercel auto-deploy every branch.

### 6. Mobile rail sheet — overlay visual

- **Why deferred:** Mobile sweep confirmed the sheet _opens_ and renders the rail (`.screenshots/wave1-finish-mobile/rail-mobile-sheet.jpeg`), but the existing overlay is `bg-black/50` — works but not in keeping with the Wave-1 spec ("Overlays/drawers must use solid `bg-bg-1`"). The existing `AppShell.tsx` already uses `bg-black/50` for the mobile rail backdrop only; the rail panel itself is fine.

- **Concrete next steps:** Decide whether the mobile-only backdrop counts as an "overlay" under the spec. If yes, switch to `bg-bg-0/85` or layer a backdrop-blur instead. Cosmetic-only.

- **Files involved:** `components/shell/AppShell.tsx` line ~74.

---

## Mobile sweep — clean

`.screenshots/wave1-finish-mobile/_findings.json`:

```json
{
  "command-center-firm": { "hOverflow": false },
  "profile": { "hOverflow": false },
  "settings-collapsed": { "hOverflow": false },
  "settings-trust": { "hOverflow": false },
  "command-center-startup": { "hOverflow": false }
}
```

Plus visually-verified shots for `rail-mobile-sheet.jpeg` (hamburger opens the rail as a sheet correctly) and `top-nav.jpeg` (band collapses to mobile width cleanly).

## a11y axe — clean

Post-fix `.screenshots/wave1-finish-a11y/axe-report.json`:

| Surface           | Passes | Violations | Incomplete | Inapplicable |
| ----------------- | ------ | ---------- | ---------- | ------------ |
| `/command-center` | 26     | **0**      | 2          | 35           |
| `/profile`        | 17     | **0**      | 0          | 44           |
| `/settings`       | 17     | **0**      | 0          | 44           |

Pre-fix had 2 violations × 3 surfaces (color-contrast on 19 dim labels, aria-hidden-focus on EarnDock). Both resolved.

---

## Guardrails Claude should respect (carried from Wave-1)

- **UI-only lane** — no edits to `lib/supabase/*`, `lib/actions/*`, `lib/queries/auth.ts`, `lib/ai/*`, `lib/team/*`, `lib/integrations/*`, `middleware.ts`, `proxy.ts`, `app/login/*`, or migrations.
- **15 brain slugs** in `lib/team/roster.ts` unchanged.
- **Tokens-only styling** — reuse `--cta-gradient`, `--shadow-cta`. No inline hex.
- **Overlays** — solid `bg-bg-1` (no translucent regression). Mobile rail backdrop is currently `bg-black/50` — see "Not shipped §6" for review.
- **Voice** — Earn always introduced as "Chief Operating Officer · your live AI guide".
- **Rail** — Admin is NOT on the rail; it lives in Settings now.
- **Pod has no `origin` remote** — user pushes via Emergent "Save to GitHub" panel. Don't fetch / push from pod.

---

## Save-to-GitHub instructions

User: click **Save to GitHub** in the Emergent panel and select the existing `emergent/wave1-finish` branch. Fast-forward expected.

⚠️ If the dialog shows a conflict on `emergent/wave1-finish`, STOP and ping Claude — would indicate unexpected divergence (pod local branch was cut from local `emergent/wave1-shell` HEAD `84cf553`, which has 2 auto-commits beyond what may have been pushed to origin).
