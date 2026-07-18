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

// Renders the REAL value at rest — the resting figure is the true number on the
// server, at first paint, with JS disabled, and if the animation never runs. The
// count-up is a pure progressive enhancement: when the stat scrolls into view it
// animates 0 → value once. This means a counter can never render as a stale 0 due
// to a hydration / observer / initialization defect; the worst case is that the
// real value simply appears without the flourish.
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
  // Initial state IS the target value (never 0), so SSR + hydration + no-JS all
  // show the true figure and there is no hydration mismatch.
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const node = ref.current;
    // No animation possible → the resting `value` already shown is correct.
    if (!node || prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      return;
    }

    const run = () => {
      if (started.current) return;
      started.current = true;

      let raf = 0;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        setDisplay(Math.round(value * eased));
        if (t < 1) raf = requestAnimationFrame(tick);
        else setDisplay(value); // guarantee we land exactly on the true value
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    };

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
