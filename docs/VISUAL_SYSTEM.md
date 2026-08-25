# FundExecs OS visual system

FundExecs OS uses an institutional command-center language in a single bold,
vibrant **daylight** palette. There is no day/night switch, no dark mode, and no
OS-driven variant: nothing ever sets the `dark` class and Tailwind runs in
`darkMode: "class"`, so a `dark:` utility never fires. Keep visual changes scoped
to the surface they serve so the app does not drift into competing themes.

Two consequences worth knowing before you style anything:

- **Never hand-darken a surface.** `bg-black`, `bg-white/5`, `border-white/10`,
  and literal dark hexes do not follow the palette and will strand a panel in
  the old scheme. Use the surface ramp (`surface-0` … `surface-3`) and `line`.
  The only surfaces that stay dark on purpose are modal scrims
  (`bg-slate-900/40`), video tiles, and sprite shadows.
- **Ink follows the fill.** The blue accent (`neural-*`, and the semantic
  `--gold-*` vars) is deep enough for white text. The warm `gold-*` ramp is
  bright amber and takes `text-on-gold` instead — white on it fails contrast.

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
- `--fx-fg-muted` is the lowest-contrast text token (~5:1 on the page). If a
  label needs to be quieter than that, it probably should not be on the screen.
- Elevation does the work shadows and glows used to do on black: a card is a
  visible `line` border plus a soft neutral shadow. Accent glows are decoration
  now, not separation — do not rely on one to divide two surfaces.

## Shared utilities

- `fx-card`, `fx-card-hover`, `fx-glass`, `fx-stat`, `fx-segment`: shared
  operating-shell surfaces.
- `fx-ambient`: page-level blue depth for command pages.
- `fx-neural-panel`, `fx-neural-card`, `fx-neural-ambient`: scoped neural
  console surfaces.
- `fx-blueprint`, `fx-orbit-card`: high-impact hero/demo surfaces with GPU-grid
  treatment and CSS-only animation.
- `fx-data-stream`: lightweight processing line for pending/activation states.

## Copilot conversations

The Earn dock holds **one conversation per place**, never one per tab:

- Identity is the location (`lib/copilot-conversations.ts`). A deal owns one
  conversation across all of its modules; every other hub/module owns its own.
- Turns never cross places. The `prior` context sent to the model is built from
  the current conversation only, so a deal's turns are never shipped as context
  for a question about Wallet.
- A conversation becomes a real session on its first reply, named
  `<Place> — <first message>`, and shows up in `/sessions` like any other work.
  The dock adopts the id from the `X-Earn-Session` response header.
- The header names the conversation, and "Recent" lists the others — each opens
  as its own session rather than loading into the current dock, so switching can
  never merge two threads.
- "Start new" clears only the current place's conversation. The session it
  already produced stays in `/sessions`.

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
