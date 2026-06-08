'use client';

import { useRef, type ReactNode } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, type Variants } from 'motion/react';

/* ============================================================================
 * components/landing/Motion.tsx — shared Framer Motion primitives for the
 * public landing. Scroll-triggered reveals (whileInView, once), staggered
 * groups, and a magnetic CTA. Everything degrades to a static render under
 * `prefers-reduced-motion`.
 * ========================================================================= */

const EASE = [0.22, 0.61, 0.36, 1] as const;

/** A single element that rises + fades in when scrolled into view. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 22,
  once = true
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount: 0.3 }}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Container that staggers its <StaggerItem/> children into view. */
export function Stagger({
  children,
  className,
  gap = 0.08,
  once = true
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  const variants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: gap } }
  };
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount: 0.2 }}
    >
      {children}
    </motion.div>
  );
}

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } }
};

/** A child of <Stagger/> — rises in on its turn. */
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={ITEM_VARIANTS}>
      {children}
    </motion.div>
  );
}

/**
 * MagneticButton — wraps content in a control that drifts toward the cursor on
 * hover (spring-damped) and settles back on leave. Renders a plain wrapper
 * under reduced-motion. Use for primary CTAs.
 */
export function Magnetic({
  children,
  className,
  strength = 0.4
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 });

  if (reduce) return <div className={className}>{children}</div>;

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  }
  function reset() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ x: sx, y: sy, display: 'inline-flex' }}
      onMouseMove={onMove}
      onMouseLeave={reset}
    >
      {children}
    </motion.div>
  );
}
