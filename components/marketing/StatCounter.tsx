"use client";

import { useEffect, useRef, useState } from "react";
import { GradientText } from "./GradientText";

type StatCounterProps = {
  /** Target number to count up to. */
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  className?: string;
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Counts up from 0 to `value` the first time it scrolls into view, easing out
// so it decelerates into the final number. Snaps straight to the value under
// reduced-motion or where IntersectionObserver is unavailable (SSR/older
// engines), so the real figure is always what's shown at rest.
export function StatCounter({
  value,
  label,
  prefix = "",
  suffix = "",
  durationMs = 1600,
  className = "",
}: StatCounterProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const run = () => {
      if (started.current) return;
      started.current = true;

      if (prefersReducedMotion()) {
        setDisplay(value);
        return;
      }

      let raf = 0;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        setDisplay(Math.round(value * eased));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    };

    if (typeof IntersectionObserver === "undefined") {
      run();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            run();
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [value, durationMs]);

  return (
    <div
      ref={ref}
      className={`flex flex-col items-center gap-2 text-center ${className}`.trim()}
    >
      <div className="font-display text-4xl font-bold tabular-nums lg:text-5xl">
        <GradientText>
          {prefix}
          {display.toLocaleString()}
          {suffix}
        </GradientText>
      </div>
      <p className="text-sm font-medium text-fg-secondary">{label}</p>
    </div>
  );
}
