'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { MOTION_EASING } from '@/components/dashboard/command/motion';

/**
 * A number that counts up to its value once, on first scroll-into-view.
 *
 * tier: meaningful — the value lands with a brief count so the operator reads
 * it as a live figure, not static chrome. Performance discipline: tabular
 * figures (`tnum`) so the glyph width never jitters mid-count (see MOTION.md).
 *
 * Reduced motion: renders the final formatted value immediately — no count.
 * The element is never blank; `format(value)` is the SSR/first-paint output,
 * so there is no layout shift and the figure is correct without JS.
 *
 * `format` maps the raw number to its display string (e.g. `compactMoney`,
 * `(n) => String(Math.round(n))`). It runs on every animation frame, so keep
 * it cheap.
 */
export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  durationMs = 1500,
  className
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const ref = useRef<HTMLSpanElement>(null);
  // First paint shows the final value, so the figure is correct before
  // hydration and there is no count-from-zero flash. Reduced motion bypasses
  // the count entirely and reads `format(value)` directly in render.
  const [display, setDisplay] = useState(() => format(value));
  const started = useRef(false);

  useEffect(() => {
    // Reduced motion: nothing to animate; render reads the value directly.
    if (reduced) return;
    const node = ref.current;
    if (!node) return;

    const run = () => {
      if (started.current) return;
      started.current = true;
      const controls = animate(0, value, {
        duration: durationMs / 1000,
        ease: MOTION_EASING.standard,
        onUpdate: (latest) => setDisplay(format(latest))
      });
      return () => controls.stop();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run();
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => observer.disconnect();
    // `format` is intentionally not a dep — count plays once per value change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs, reduced]);

  return (
    <span ref={ref} className={className} style={{ fontFeatureSettings: "'tnum'" }}>
      {reduced ? format(value) : display}
    </span>
  );
}
