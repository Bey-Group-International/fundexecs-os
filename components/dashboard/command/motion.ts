'use client';

import type { Transition, Variants } from 'motion/react';

/* ============================================================================
 * command/motion.ts — shared Framer Motion vocabulary for the command center.
 *
 * One spring, one ease, one stagger rhythm so every module enters, collapses,
 * and reacts on the same physics. Reduced-motion is handled globally by the
 * <MotionConfig reducedMotion="user"> in DashboardShell, so these variants stay
 * declarative and the OS preference neutralizes them automatically.
 * ========================================================================= */

/** The house spring — used for hover/press reactivity on live functions. */
export const FX_SPRING: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 32,
  mass: 0.7
};

/** The house ease — matches the CSS `cubic-bezier(0.22, 0.61, 0.36, 1)`. */
export const FX_EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

/** Staggered-reveal container: children rise in sequence on first paint. */
export const fxStagger: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.02 }
  }
};

/** A single revealed item — rises + fades into place. */
export const fxRiseItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: FX_EASE }
  }
};

/** Collapse/expand body transition (height + opacity). */
export const fxCollapse: Transition = { duration: 0.28, ease: FX_EASE };

/** Hover/press reactivity for interactive function tiles + control buttons. */
export const fxPressable = {
  whileHover: { y: -2, scale: 1.01 },
  whileTap: { scale: 0.985 },
  transition: FX_SPRING
} as const;
