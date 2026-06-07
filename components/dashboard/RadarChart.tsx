'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface RadarAxis {
  /** Short axis label, e.g. "Profile". */
  label: string;
  /** 0–100 value for this axis. */
  value: number;
}

export interface RadarChartProps {
  axes: RadarAxis[];
  size?: number;
  /** Polygon + stroke color. */
  color?: string;
  /** Grid ring color. */
  gridColor?: string;
  /** Number of concentric grid rings. */
  rings?: number;
  ariaLabel: string;
  className?: string;
  durationMs?: number;
}

/**
 * RadarChart — dependency-free SVG spider/radar plot over N axes (0–100 each).
 * Draws concentric grid rings, axis spokes + labels, and an animated value
 * polygon that scales in from the center. Honors `prefers-reduced-motion`
 * (snaps to full). Token-driven colors.
 */
export function RadarChart({
  axes,
  size = 260,
  color = 'var(--accent)',
  gridColor = 'var(--border)',
  rings = 4,
  ariaLabel,
  className,
  durationMs = 900
}: RadarChartProps) {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      frame.current = requestAnimationFrame(() => setProgress(1));
      return () => {
        if (frame.current) cancelAnimationFrame(frame.current);
      };
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [durationMs]);

  const cx = size / 2;
  const cy = size / 2;
  const labelPad = 34;
  const radius = size / 2 - labelPad;
  const n = axes.length;

  // Angle for axis i (start at top, clockwise).
  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pointAt = (i: number, ratio: number) => {
    const a = angleFor(i);
    return [cx + Math.cos(a) * radius * ratio, cy + Math.sin(a) * radius * ratio] as const;
  };

  const gridPolys = Array.from({ length: rings }, (_, ringIdx) => {
    const ratio = (ringIdx + 1) / rings;
    return axes
      .map((_, i) => {
        const [x, y] = pointAt(i, ratio);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  const valuePoly = axes
    .map((axis, i) => {
      const ratio = (Math.max(0, Math.min(100, axis.value)) / 100) * progress;
      const [x, y] = pointAt(i, ratio);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn('block h-auto w-full max-w-full', className)}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Grid rings */}
      {gridPolys.map((poly, i) => (
        <polygon key={i} points={poly} fill="none" stroke={gridColor} strokeWidth={1} />
      ))}
      {/* Spokes */}
      {axes.map((_, i) => {
        const [x, y] = pointAt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={gridColor} strokeWidth={1} />;
      })}
      {/* Value polygon */}
      <polygon points={valuePoly} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} />
      {/* Value vertices */}
      {axes.map((axis, i) => {
        const ratio = (Math.max(0, Math.min(100, axis.value)) / 100) * progress;
        const [x, y] = pointAt(i, ratio);
        return <circle key={i} cx={x} cy={y} r={3} fill={color} />;
      })}
      {/* Axis labels */}
      {axes.map((axis, i) => {
        const [x, y] = pointAt(i, 1.16);
        const a = angleFor(i);
        const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-fg-3 text-[10px] font-semibold uppercase"
            style={{ letterSpacing: '0.06em' }}
          >
            {axis.label}
          </text>
        );
      })}
    </svg>
  );
}

export default RadarChart;
