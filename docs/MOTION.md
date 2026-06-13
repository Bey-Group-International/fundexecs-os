# Motion system

The single reference for how FundExecs OS moves. Every animation in the
product — whether CSS keyframe, Tailwind transition utility, or a
`motion/react` component — should map back to a token and a tier
documented here.

## The institutionally intentional bar

Motion in FundExecs OS exists to make state changes legible, to anchor
attention where the operator's eye should land, and to make the product
feel premium and trustworthy. Every animation must answer one question:
what state change or attention does this serve? If the honest answer is
"none," cut it. We do not animate to delight at the expense of focus, we
do not animate to fill silence, and we do not animate to compete with
consumer products. Restraint is the design system.

The default posture is calm. The authenticated product reads as
institutional first; the public landing is allowed slightly more
permission to be cinematic, but the same bar applies to every effect
there — see the two-bar policy below.

## Token reference

The motion tokens live in `app/globals.css` under `:root` and have JS
twins in `components/dashboard/command/motion.ts` (`MOTION_EASING`,
`MOTION_DURATIONS_S`). The CSS values and the JS values must stay in
sync — adding a new token requires updating both files in the same PR.

### Easing

| Token              | CSS value                           | JS twin                   | Use for                                                           |
| ------------------ | ----------------------------------- | ------------------------- | ----------------------------------------------------------------- |
| `--ease-standard`  | `cubic-bezier(0.22, 0.61, 0.36, 1)` | `MOTION_EASING.standard`  | The house ease. The authoritative reference.                      |
| `--ease-entrance`  | alias of standard                   | `MOTION_EASING.entrance`  | Rises, reveals, page-enters.                                      |
| `--ease-exit`      | alias of standard                   | `MOTION_EASING.exit`      | Dismissals, drawer slide-outs.                                    |
| `--ease-emphasize` | `ease-in-out`                       | `MOTION_EASING.emphasize` | Breathing attention loops (glow, think dots, cascade, orb pulse). |
| `--ease-soft-out`  | `ease-out`                          | `MOTION_EASING.softOut`   | One-shot fades and soft glows that settle to rest.                |
| `--ease-linear`    | `linear`                            | `MOTION_EASING.linear`    | Continuous spins, marquees, gradient sweeps.                      |

`--ease-entrance` and `--ease-exit` alias the standard ease in v1. They
exist as semantic hooks so a future phase can give entrances and exits
distinct curves without a rename pass through every consumer.

### Duration

Short-scale tokens are interchangeable across surfaces; sustained tokens
are surface-specific.

| Token                  | CSS value | JS twin (seconds) | Use for                                                |
| ---------------------- | --------- | ----------------- | ------------------------------------------------------ |
| `--dur-instant`        | `80ms`    | `0.08`            | Micro-interaction (focus rings, press feedback).       |
| `--dur-quick`          | `160ms`   | `0.16`            | Hover/exit reactivity.                                 |
| `--dur-standard`       | `240ms`   | `0.24`            | Menus, popovers, in-panel toggles.                     |
| `--dur-collapse`       | `280ms`   | `0.28`            | Framer-motion collapse/expand body (height + opacity). |
| `--dur-dock-slide`     | `300ms`   | `0.3`             | EarnDock right-side slide-in / slide-out.              |
| `--dur-status`         | `400ms`   | `0.4`             | Status-line handoff fade.                              |
| `--dur-page`           | `420ms`   | `0.42`            | Page-enter rise (`fx-rise`).                           |
| `--dur-celebrate`      | `500ms`   | `0.5`             | One-shot celebration entrance.                         |
| `--dur-think`          | `1250ms`  | `1.25`            | Earn thinking dots breathing cycle.                    |
| `--dur-celebrate-glow` | `1600ms`  | `1.6`             | Celebrate glow envelope.                               |
| `--dur-cascade`        | `1800ms`  | `1.8`             | Desk on-point cascade loop.                            |
| `--dur-onpoint`        | `2200ms`  | `2.2`             | On-point pulse on the active avatar.                   |
| `--dur-glow`           | `2400ms`  | `2.4`             | Live-presence breathing, desk-shimmer hairline.        |
| `--dur-orb-pulse`      | `2600ms`  | `2.6`             | Earn orb context pulse.                                |
| `--dur-sweep`          | `4500ms`  | `4.5`             | Product-preview gloss sweep.                           |
| `--dur-coin-float`     | `5000ms`  | `5`               | Landing mascot coin float.                             |
| `--dur-text-shimmer`   | `6000ms`  | `6`               | Landing animated-gradient text shimmer.                |
| `--dur-grid-pan`       | `12000ms` | `12`              | Landing textured-grid backdrop pan.                    |
| `--dur-aurora`         | `18000ms` | `18`              | Landing aurora drift.                                  |
| `--dur-spin-outer`     | `48000ms` | `48`              | Constellation orbit, outer ring.                       |
| `--dur-spin-inner`     | `60000ms` | `60`              | Constellation orbit, inner ring.                       |
| `--dur-marquee`        | `60000ms` | `60`              | Landing live-activity marquee.                         |

The house spring (`FX_SPRING` in `motion.ts` — stiffness 420, damping
32, mass 0.7) is not a CSS token because CSS has no spring primitive.
Use it via `motion/react` for hover and press reactivity on interactive
tiles and control buttons.

## Named primitives

Each `fx-*` rule in `app/globals.css` carries a tier comment above the
declaration. The tier governs reduced-motion behavior (see below) and
is the rubric for any future addition.

### Authenticated surfaces

| Class                                                          | Tier       | What it expresses                                     | Where it's used                             |
| -------------------------------------------------------------- | ---------- | ----------------------------------------------------- | ------------------------------------------- |
| `fx-rise`                                                      | meaningful | You arrived at a new surface.                         | `AppShell.tsx`, keyed by route.             |
| `fx-glow-pulse`                                                | meaningful | This element is live and in use.                      | Presence dots, EarnOrb halo.                |
| `.earn-orb[data-context]` (keyframes: `fx-earn-context-pulse`) | meaningful | The orb knows what surface you're focused on.         | `EarnOrb` via `data-context`.               |
| `fx-celebrate` + `fx-celebrate-glow`                           | meaningful | A reward state change just happened.                  | Level-up, streak-high, badge-earned toasts. |
| `fx-onpoint-pulse`                                             | meaningful | This specialist is on point for the current request.  | Active avatar in the desk strip.            |
| `fx-earn-think`                                                | meaningful | Earn is processing your request (Cognition: routing). | `EarnCognition` thinking dots.              |
| `fx-onpoint-cascade`                                           | meaningful | The desk is coordinating around a request.            | `EarnAgentActivity` while busy.             |
| `fx-status-fade`                                               | meaningful | The desk status line just changed.                    | Status handoffs in the dock.                |
| `fx-desk-shimmer`                                              | meaningful | Earn is working under the desk strip.                 | Hairline under `EarnAgentActivity`.         |
| `fx-no-transition`                                             | utility    | Suppresses every transition during a theme flip.      | Theme toggle.                               |

### Landing surfaces

| Class                                                                           | Tier       | What it expresses         | Where it's used           |
| ------------------------------------------------------------------------------- | ---------- | ------------------------- | ------------------------- |
| `fx-coin-float`                                                                 | decorative | Landing mascot ambience.  | Public `/` hero.          |
| `fx-marquee` (`fx-marquee-animate`, `fx-marquee-wrap`)                          | decorative | Living activity backdrop. | `ActivityTicker`.         |
| `fx-aurora`                                                                     | decorative | Landing atmosphere.       | Hero / section backdrops. |
| `fx-text-gradient`                                                              | decorative | Headline flourish.        | Hero title.               |
| `fx-grid-pan`                                                                   | decorative | Textured backdrop.        | Background panels.        |
| `fx-spin-slow` / `fx-spin-slow-rev` / `fx-counter-spin` / `fx-counter-spin-rev` | decorative | Constellation orbit.      | `TeamConstellation`.      |
| `fx-sweep`                                                                      | decorative | Product-preview gloss.    | `ProductPreview`.         |

## The two-bar policy

The bar for "intentional" is the same for both surfaces, but the
permission to be cinematic differs.

- **Authenticated.** Restraint is the default. Motion communicates
  state; it does not decorate. New animations on authenticated surfaces
  must clear the tier=meaningful test before they ship. If a candidate
  effect cannot name the state it serves, it does not belong here.

- **Landing.** Cinematic motion is permitted in service of the brand
  promise (institutional, premium, trust-signaling). Each effect still
  has to earn its place: aurora, marquee, constellation, mascot float,
  text shimmer exist because they collectively shape the first 90
  seconds of a new operator's impression. Anything added beyond this
  set has to displace something else.

Both bars share the performance discipline below, and both honor the
reduced-motion tiering below.

## Reduced-motion tiering

Two tiers, two behaviors under `@media (prefers-reduced-motion: reduce)`.
Phase 2 enforces this; the CSS rule structure has been split so the
behavior matches the documentation.

- **Meaningful motion stays on, softened.** Each `fx-*` class tagged
  `meaningful` keeps animating under reduced motion but is replaced by
  a dedicated `fx-*-rm` keyframe that lands the element at its
  meaningful end state in a single, calm pass:
  - max duration is `--dur-standard` (240 ms);
  - `animation-iteration-count` is clamped to 1 (no infinite loops);
  - opacity-only or `≤4 px` transform; box-shadow halos are allowed;
  - lands at the peak/settled state so the indicator stays visible
    after the brief animation (e.g. the orb halo settles to its gold
    ring instead of pulsing forever).

  The reduced-motion variants live alongside their base keyframes in
  `app/globals.css` under the comment block "Meaningful-tier
  reduced-motion keyframes".

- **Decorative motion goes off.** `fx-coin-float`, `fx-marquee-animate`,
  `fx-aurora`, `fx-text-gradient`, `fx-grid-pan`, the four constellation
  spin classes, and `fx-sweep` are hard-disabled via
  `animation-name: none !important` under reduced motion.

- **Safety net.** A universal `* { animation-duration: 0.001ms !important; … }`
  rule remains as the final layer so anything the design system did NOT
  author (third-party widgets, transient inline animations) is also
  neutralized. The class-targeted meaningful and decorative rules above
  beat this universal one via specificity (`0,1,0` > `0,0,0`) even when
  both use `!important`.

### Authoring rule for new motion

When you add a new `fx-*` class:

1. Tag the tier in its leading comment.
2. If it is `meaningful`, also author a sibling `fx-<name>-rm` keyframe
   and add a class-targeted override inside the `@media
(prefers-reduced-motion: reduce)` block. Follow the existing
   pattern (single shot, ≤ 240 ms, opacity-led, lands at peak).
3. If it is `decorative`, add the class to the decorative-tier
   `animation-name: none !important` selector list.
4. Update the inventory tables above in the same PR.

## Performance discipline

These rules are non-negotiable; they apply to every animation the
product ships.

- **Transform, opacity, and `background-position` only.** Never
  animate layout-affecting properties (`width`, `height`, `top`,
  `left`, `margin`, `padding`, `font-size`, etc.). The
  `TrustDrawer` progress-bar `width` animation is an explicit
  exception; it animates a single internal bar whose containing block
  is otherwise stable, but new layout-property animations must be
  reviewed and justified in the PR.
- **`will-change: transform` is for surfaces that actually transform.**
  It is on the drawers, the Earn dock, and the orb. It must not be
  sprinkled on static elements; doing so promotes pointless GPU
  layers.
- **Tabular figures for any number that animates.** `AnimatedNumber`
  uses `font-feature-settings: 'tnum'` so the displayed width does not
  jitter mid-count. Any new count-up or live number must do the same.
- **Off-screen loops pause where the cost is non-trivial.** The
  marquee pauses on `:hover` and `:focus-within`, AND on
  `data-in-view="false"` (set by an `IntersectionObserver` in
  `ActivityTicker`), so the 60-second loop stops while the ticker is
  off-screen. Any future long-running landing loop should follow the
  same pattern.

## The `motion/react` rule

The animation library this codebase uses is `motion@^12` (the project
formerly known as `framer-motion`). Imports always come from
`motion/react`. Do NOT downgrade to the `framer-motion` package name
even if older code comments mention it — the package has been
rebranded, the APIs are equivalent, and `motion` is the current source
of truth in `package.json`.

When importing motion primitives:

- Component variants live in `components/dashboard/command/motion.ts`
  (`fxStagger`, `fxRiseItem`, `fxCollapse`, `fxPressable`) and are
  re-exported from there for any consumer.
- Easing arrays and durations come from `MOTION_EASING` and
  `MOTION_DURATIONS_S` in the same file.
- Reusable consumers wrap those variants so call sites stay declarative:
  `MotionStagger` + `MotionItem` (group cascade) and `Reveal` (single
  scroll-reveal) live in `components/dashboard/command/MotionReveal.tsx`;
  `AnimatedNumber` (count-up, tabular figures, reduced-motion safe) lives
  in `components/ui/AnimatedNumber.tsx`. Each guards `useReducedMotion()`
  itself, so they render statically without the `MotionConfig` ancestor.
- Reduced motion is honored via the `<MotionConfig reducedMotion="user">`
  in `AppShell` (`components/shell/AppShell.tsx`) and `useReducedMotion()`
  at the call site.
- Per-component motion code stays declarative — favor `variants`,
  `whileHover`, `whileTap`, `whileInView` over imperative
  `useAnimate()` choreography. Imperative animation belongs in a
  hook (e.g. `useEarnLifecycle`), not in a render path.

## Adding new motion

Before opening a PR that adds an animation, check the following in
order:

1. Can the existing tokens express the new motion? If yes, use them.
2. If no existing duration token fits, add a token to `:root` in
   `app/globals.css` AND its twin to `MOTION_DURATIONS_S` in
   `motion.ts`. Same for easings.
3. Tag the new `fx-*` rule with its tier. Be honest. If it is
   ambiguous, lean decorative.
4. Confirm transform/opacity/background-position only.
5. Verify reduced-motion behavior matches the tier.
6. Document the new primitive in the inventory tables above in the
   same PR. If the inventory and the code drift, the inventory is
   wrong — fix it in code review.
