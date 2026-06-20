# FundExecs OS visual system

FundExecs OS uses a dark, institutional command-center language. Keep visual
changes scoped to the surface they serve so the app does not drift into competing
themes.

## Accent zones

- **Gold (`gold.*`)**: default operating shell, navigation, dashboard, hubs,
  settings, marketing, and general CTAs.
- **Neural green (`neural.*`)**: compute-heavy surfaces only: Wallet/Credits,
  billing plan cards, and the Earn copilot terminal chrome.
- **Status tokens (`status.*`)**: semantic state only: success, warning, info,
  danger. Prefer these over raw Tailwind `emerald-*`, `red-*`, or `blue-*` when
  the color is communicating state.
- **Agent palette (`agent.*`)**: identity colors for named agents. Do not use
  agent colors as generic UI accents.

## Shared utilities

- `fx-card`, `fx-card-hover`, `fx-glass`, `fx-stat`, `fx-segment`: warm
  operating-shell surfaces.
- `fx-ambient`: page-level gold depth for command pages.
- `fx-neural-panel`, `fx-neural-card`, `fx-neural-ambient`: scoped neural
  console surfaces.
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
