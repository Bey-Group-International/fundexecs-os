"use client";

import { useEffect, useRef, useState } from "react";

function useCountUp(target: number, duration = 750) {
  const [current, setCurrent] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    const start = performance.now();
    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(eased * target));
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, duration]);
  return current;
}

export function StatTile({
  label,
  value,
  trend,
  delay = 0,
}: {
  label: string;
  value: number;
  trend?: "up" | "down" | "neutral";
  delay?: number;
}) {
  const display = useCountUp(value);

  return (
    <div
      className="fx-card fx-card-hover fx-stat-shimmer group relative overflow-hidden p-4 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Top-edge gold hairline brightens on hover */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/55 to-transparent transition-opacity duration-300 group-hover:via-gold-300/80"
      />
      {/* Bottom neural sweep on hover */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-neural-400/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">{label}</p>
      <div className="mt-2 flex items-end gap-2">
        <p className="font-display text-[2.1rem] font-bold leading-none tracking-tight text-fg-primary transition-colors duration-200 group-hover:text-white">
          {display}
        </p>
        {trend && trend !== "neutral" && (
          <span
            className={`mb-1 font-mono text-sm font-bold leading-none ${
              trend === "up" ? "text-status-success" : "text-status-danger"
            }`}
          >
            {trend === "up" ? "↑" : "↓"}
          </span>
        )}
      </div>
      {/* Ghost watermark number — subtle depth layer */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-1.5 right-3 select-none font-display text-[2rem] font-bold leading-none text-gold-400/6 transition-colors duration-300 group-hover:text-gold-400/12"
      >
        {value}
      </span>
    </div>
  );
}
