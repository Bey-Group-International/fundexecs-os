'use client';

import { motion, useReducedMotion } from 'motion/react';
import { fxRiseItem, fxStagger } from '@/components/dashboard/command/motion';

/**
 * Staggered entrance for a group of cards/rows.
 *
 * tier: meaningful — "this surface is assembling for you". Wrap a grid or list
 * in `<MotionStagger>` and each direct child in `<MotionItem>`; the children
 * rise + fade in a short cascade. Reduced motion is honored two ways: the
 * app-level `<MotionConfig reducedMotion="user">` neutralizes the transforms,
 * and as a belt-and-braces guard we also render statically when
 * `useReducedMotion()` is true, so the content is never hidden pre-animation.
 *
 * Use `whileInView` (default) for content that may sit below the fold —
 * pass `immediate` to animate on mount instead (above-the-fold heroes).
 */
export function MotionStagger({
  children,
  className,
  immediate = false
}: {
  children: React.ReactNode;
  className?: string;
  immediate?: boolean;
}) {
  const reduced = useReducedMotion() ?? false;

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  const animateProps = immediate
    ? { animate: 'show' as const }
    : { whileInView: 'show' as const, viewport: { once: true, amount: 0.2 } };

  return (
    <motion.div className={className} variants={fxStagger} initial="hidden" {...animateProps}>
      {children}
    </motion.div>
  );
}

/**
 * A self-contained scroll-reveal for a single block (no `<MotionStagger>`
 * parent needed). The block rises + fades once as it scrolls into view.
 *
 * Landing-tier use: the public page has cinematic permission (see the two-bar
 * policy in docs/MOTION.md), and a per-section reveal is an entrance, not an
 * ambient loop, so it shapes the scroll without competing for attention.
 * Reduced motion renders the block statically and immediately.
 */
export function Reveal({
  children,
  className,
  style
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = useReducedMotion() ?? false;

  if (reduced) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={className}
      style={style}
      variants={fxRiseItem}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
    >
      {children}
    </motion.div>
  );
}

/** A single staggered child. Must be a direct descendant of `<MotionStagger>`. */
export function MotionItem({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div className={className} variants={fxRiseItem}>
      {children}
    </motion.div>
  );
}
