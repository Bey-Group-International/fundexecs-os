# FundExecs OS visual system

FundExecs OS uses an institutional command-center language in a single bold,
high-contrast palette. There is no day/night switch and no OS-driven variant:
`<html>` carries `dark` permanently and Tailwind runs in `darkMode: "class"`, so
a `dark:` utility never flips with the viewer's system preference. Keep visual
changes scoped to the surface they serve so the app does not drift into
competing themes.

## Accent zones

- **Blue accent (`gold.*`)**: default operating shell, navigation, dashboard,
  hubs, settings, marketing, and general CTAs. The class name remains `gold.*`
  for compatibility, but the resolved palette is electric blue.
- **Neural blue (`neural.*`)**: compute-heavy surfaces only: Wallet/Credits,
  billing plan cards, graph animations, and the Earn copilot terminal chrome.
- **Status tokens (`status.*`)**: semantic state only: success, warning, info,
  danger. Prefer these over raw Tailwind `emerald-*`, `red-*`, or `blue-*` when
  the color is communicating state.
- **Agent palette (`agent.*`)**: identity colors for named agents. Do not use
  agent colors as generic UI accents.

## Legibility floor

Wording has to survive a real trading desk, not a design screenshot:

- **11px is the smallest type on the platform.** `text-[11px]` is the floor for
  eyebrows, chips, and metadata; anything an operator reads rather than glances
  at belongs at `text-xs` (12px) or larger. Do not reintroduce `text-[8px]`,
  `text-[9px]`, or `text-[10px]`.
- **Cap letter-spacing at `tracking-[0.16em]`.** Wider tracking pulls small
  uppercase labels apart into loose letters instead of words.
- **Prefer sentence case over uppercase mono for anything clickable.** Uppercase
  mono is for section eyebrows; controls read as controls.
- `--fx-fg-muted` is the lowest-contrast text token. If a label needs to be
  quieter than that, it probably should not be on the screen.

## Shared utilities

- `fx-card`, `fx-card-hover`, `fx-glass`, `fx-stat`, `fx-segment`: shared
  operating-shell surfaces.
- `fx-ambient`: page-level blue depth for command pages.
- `fx-neural-panel`, `fx-neural-card`, `fx-neural-ambient`: scoped neural
  console surfaces.
- `fx-blueprint`, `fx-orbit-card`: high-impact hero/demo surfaces with GPU-grid
  treatment and CSS-only animation.
- `fx-data-stream`: lightweight processing line for pending/activation states.

## Overlay placement

The Earn launcher owns the bottom-right corner. The guided tour sits above it
(`bottom-24`, lower `z-index`) so demos do not stack two controls on the same
hit target.

## Brand mark

Use `components/Logo.tsx` for wordmark, coin, and coin+wordmark placements.
This keeps `/earn-coin.png` usage centralized across public and authed surfaces.

## Demo smoke notes

Public routes and generated/static visual assets can be smoke-tested without
secrets. Authenticated routes require Supabase environment variables:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run dev
```

Expected local limitation without Supabase env: `/login` and authenticated pages
return a Supabase client configuration error. This is environment setup, not a
visual-stack failure.
