'use client';

import type { Transition, Variants } from 'motion/react';

/* ============================================================================
 * command/motion.ts — shared Motion (formerly framer-motion) vocabulary for
 * the command center, and the JS twin of the CSS motion tokens declared in
 * app/globals.css.
 *
 * Rule of thumb: every easing or duration used by a `motion/react` consumer
 * in this codebase MUST come from one of the constants exported here, and
 * those constants MUST match the CSS tokens by value. CSS and JS tokens drift
 * silently if anyone hand-edits one without the other — the inline comments
 * below pin each pair so a reviewer can spot a mismatch in seconds.
 *
 * Reduced-motion: framer-motion respects the OS preference globally via the
 * <MotionConfig reducedMotion="user"> in DashboardShell. These variants stay
 * declarative; the OS preference neutralizes them automatically.
 *
 * See docs/MOTION.md for the full reference, the two-bar policy (landing vs
 * authenticated), and the meaningful-vs-decorative reduced-motion tiering.
 * ========================================================================= */

/** JS twin of the CSS easing tokens. Each entry mirrors the corresponding
 *  `--ease-*` custom property by value. Bezier easings are 4-tuples (Motion's
 *  required shape); keyword easings are strings. */
export const MOTION_EASING = {
  /** Mirrors `--ease-standard`. The house ease. */
  standard: [0.22, 0.61, 0.36, 1] as [number, number, number, number],
  /** Mirrors `--ease-entrance` (alias of standard). Rises, reveals, page-enters. */
  entrance: [0.22, 0.61, 0.36, 1] as [number, number, number, number],
  /** Mirrors `--ease-exit` (alias of standard). Dismissals, drawer slide-outs. */
  exit: [0.22, 0.61, 0.36, 1] as [number, number, number, number],
  /** Mirrors `--ease-emphasize`. Breathing attention loops. */
  emphasize: 'easeInOut' as const,
  /** Mirrors `--ease-soft-out`. One-shot fades, soft glows that settle. */
  softOut: 'easeOut' as const,
  /** Mirrors `--ease-linear`. Continuous spins, marquees, gradient sweeps. */
  linear: 'linear' as const
} as const;

/** JS twin of the CSS duration tokens. Motion takes `duration` in SECONDS;
 *  the CSS tokens are declared in ms. The pair below is in seconds so it
 *  drops straight into a Motion `transition` field; the `// = NNNms` comments
 *  pin the relationship to the CSS side. */
export const MOTION_DURATIONS_S = {
  /** Mirrors `--dur-instant`. = 80ms. Micro-interaction (focus, press). */
  instant: 0.08,
  /** Mirrors `--dur-quick`. = 160ms. Hover/exit reactivity. */
  quick: 0.16,
  /** Mirrors `--dur-standard`. = 240ms. Menus, popovers, in-panel toggles. */
  standard: 0.24,
  /** Mirrors `--dur-status`. = 400ms. Status-line handoffs. */
  status: 0.4,
  /** Mirrors `--dur-page`. = 420ms. Page-enter rise (fx-rise). */
  page: 0.42,
  /** Mirrors `--dur-celebrate`. = 500ms. One-shot celebration entrance. */
  celebrate: 0.5,
  /** Mirrors `--dur-collapse`. = 280ms. Framer-motion collapse/expand body. */
  collapse: 0.28,
  /** Mirrors `--dur-dock-slide`. = 300ms. EarnDock right-side slide. */
  dockSlide: 0.3,
  /** Mirrors `--dur-think`. = 1250ms. Earn thinking dots cycle. */
  think: 1.25,
  /** Mirrors `--dur-celebrate-glow`. = 1600ms. */
  celebrateGlow: 1.6,
  /** Mirrors `--dur-cascade`. = 1800ms. */
  cascade: 1.8,
  /** Mirrors `--dur-onpoint`. = 2200ms. */
  onpoint: 2.2,
  /** Mirrors `--dur-glow`. = 2400ms. Live-presence + desk-shimmer. */
  glow: 2.4,
  /** Mirrors `--dur-orb-pulse`. = 2600ms. Earn orb context pulse. */
  orbPulse: 2.6,
  /** Mirrors `--dur-sweep`. = 4500ms. Product-preview gloss. */
  sweep: 4.5,
  /** Mirrors `--dur-coin-float`. = 5000ms. Landing mascot float. */
  coinFloat: 5,
  /** Mirrors `--dur-text-shimmer`. = 6000ms. Landing text shimmer. */
  textShimmer: 6,
  /** Mirrors `--dur-grid-pan`. = 12000ms. Landing grid backdrop. */
  gridPan: 12,
  /** Mirrors `--dur-aurora`. = 18000ms. Landing aurora drift. */
  aurora: 18,
  /** Mirrors `--dur-spin-outer`. = 48000ms. Constellation outer ring. */
  spinOuter: 48,
  /** Mirrors `--dur-spin-inner`. = 60000ms. Constellation inner ring. */
  spinInner: 60,
  /** Mirrors `--dur-marquee`. = 60000ms. Landing live-activity marquee. */
  marquee: 60
} as const;

/** The house spring — used for hover/press reactivity on live functions.
 *  Values are kept here (not in MOTION_EASING) because a spring is a physics
 *  config, not a bezier/keyword; CSS has no equivalent. */
export const FX_SPRING: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 32,
  mass: 0.7
};

/** The house ease — back-compat re-export of `MOTION_EASING.standard`.
 *  New code should reference `MOTION_EASING.entrance` / `.exit` / `.standard`
 *  directly so the semantic intent is obvious at the call site. */
export const FX_EASE: [number, number, number, number] = MOTION_EASING.standard;

/** Staggered-reveal container: children rise in sequence on first paint. */
export const fxStagger: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.02 }
  }
};

/** A single revealed item — rises + fades into place. Uses the page-enter
 *  duration so an in-grid Stagger reveal lands at the same tempo as the
 *  global `.fx-rise` route-enter. */
export const fxRiseItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: MOTION_DURATIONS_S.page, ease: MOTION_EASING.entrance }
  }
};

/** Collapse/expand body transition (height + opacity). Preserves the
 *  pre-tokenization 280 ms timing — distinct from the standard 240 ms
 *  in-panel transitions because a collapse needs slightly more breathing
 *  room to read as deliberate. */
export const fxCollapse: Transition = {
  duration: MOTION_DURATIONS_S.collapse,
  ease: MOTION_EASING.standard
};

/** Hover/press reactivity for interactive function tiles + control buttons. */
export const fxPressable = {
  whileHover: { y: -2, scale: 1.01 },
  whileTap: { scale: 0.985 },
  transition: FX_SPRING
} as const;
