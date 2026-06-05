'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface AnimatedNumberProps {
  /** The final value to count up to. */
  value: number;
  /** Animation duration in ms. */
  durationMs?: number;
  className?: string;
  /** Format the rounded display value. Defaults to a locale string. */
  format?: (n: number) => string;
}

/**
 * Counts up from 0 to `value` on mount with an ease-out curve — the "live
 * stat" feel. Renders 0 on the server and the first client frame (so there is
 * no hydration mismatch), then animates. Honors `prefers-reduced-motion` by
 * snapping straight to the final value. Tabular figures keep the width stable
 * so layout never jitters mid-count.
 */
export function AnimatedNumber({
  value,
  durationMs = 900,
  className,
  format
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      // Snap to the final value on the next frame (avoids setState in the
      // effect body, which the react-hooks lint flags).
      frame.current = requestAnimationFrame(() => setDisplay(value));
      return () => {
        if (frame.current) cancelAnimationFrame(frame.current);
      };
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(value * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value, durationMs]);

  const rounded = Math.round(display);
  const text = format ? format(rounded) : rounded.toLocaleString();
  return <span className={cn("[font-feature-settings:'tnum']", className)}>{text}</span>;
}
