// components/dashboard/command/motion.ts
//
// The JS twins of the CSS motion tokens in `app/globals.css`. Every
// `motion/react` animation in the product reads its easing, duration, and
// spring from here so the JS-driven motion and the CSS keyframes stay in
// lockstep. See docs/MOTION.md — when a token changes in `:root`, change its
// twin here in the same PR (and vice-versa).
//
// Nothing in this file imports `motion/react`; these are plain serializable
// values and Variants objects, so the module is safe to import from server or
// client code. The reduced-motion contract is honored at the call site via
// `useReducedMotion()` and the app-level `<MotionConfig reducedMotion="user">`.

import type { Transition, Variants } from 'motion/react';

/* ── Easing — JS twins of the CSS `--ease-*` tokens ───────────────────────── */
// `standard` is the authoritative house curve (cubic-bezier in CSS → bezier
// array here). `entrance`/`exit` alias it in v1, exactly as the CSS does.
export const MOTION_EASING = {
  standard: [0.22, 0.61, 0.36, 1],
  entrance: [0.22, 0.61, 0.36, 1],
  exit: [0.22, 0.61, 0.36, 1],
  emphasize: 'easeInOut',
  softOut: 'easeOut',
  linear: 'linear'
} as const;

/* ── Duration — JS twins of the CSS `--dur-*` tokens, in seconds ──────────── */
export const MOTION_DURATIONS_S = {
  instant: 0.08,
  quick: 0.16,
  standard: 0.24,
  collapse: 0.28,
  dockSlide: 0.3,
  status: 0.4,
  page: 0.42,
  celebrate: 0.5,
  think: 1.25,
  celebrateGlow: 1.6,
  cascade: 1.8,
  onpoint: 2.2,
  glow: 2.4,
  orbPulse: 2.6,
  sweep: 4.5,
  coinFloat: 5,
  textShimmer: 6,
  gridPan: 12,
  aurora: 18,
  spinOuter: 48,
  spinInner: 60,
  marquee: 60
} as const;

/* ── The house spring ─────────────────────────────────────────────────────
   CSS has no spring primitive, so this token lives only in JS. Use it for
   hover/press reactivity on interactive tiles and control buttons — confident
   settle, no overshoot wobble. */
export const FX_SPRING: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 32,
  mass: 0.7
};

/* ── Stagger container ─────────────────────────────────────────────────────
   tier: meaningful — "your surface is assembling". Drive a group of cards or
   list rows in with a short cascade. Pair with `fxRiseItem` on each child.
   `whileInView` consumers should set `viewport={{ once: true }}` so a card
   never re-animates on scroll-back. */
export const fxStagger: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.09,
      delayChildren: 0.06
    }
  }
};

/* ── Stagger child — a pronounced rise + settle (JS twin of `fx-rise`) ─────── */
export const fxRiseItem: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: MOTION_DURATIONS_S.celebrate,
      ease: MOTION_EASING.entrance
    }
  }
};

/* ── Collapse/expand body — height + opacity ──────────────────────────────── */
// The documented exception to "transform/opacity only": a single internal
// body whose containing block is otherwise stable (see MOTION.md performance
// discipline). Use for in-panel disclosure.
export const fxCollapse: Variants = {
  collapsed: { height: 0, opacity: 0 },
  open: {
    height: 'auto',
    opacity: 1,
    transition: {
      duration: MOTION_DURATIONS_S.collapse,
      ease: MOTION_EASING.standard
    }
  }
};

/* ── Pressable — hover lift + tap settle for interactive tiles/buttons ─────── */
// Spread onto a `motion.*` element. Reduced motion is honored globally by the
// app-level `<MotionConfig reducedMotion="user">`, which neutralizes these
// transforms; no per-call guard needed.
export const fxPressable = {
  whileHover: { y: -4, scale: 1.02, transition: FX_SPRING },
  whileTap: { scale: 0.95, transition: FX_SPRING }
} as const;
