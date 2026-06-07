'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface RingGaugeSegment {
  /** 0–100 value this segment fills. */
  value: number;
  /** Stroke color (token or hex). */
  color: string;
  /** Short accessible label, e.g. "Truth". */
  label?: string;
}

export interface RingGaugeProps {
  /** Primary 0–100 value for the outer ring (used when `segments` is absent). */
  value?: number;
  /** Multi-segment ring (Chain-of-Trust layers). Drawn as stacked arcs. */
  segments?: RingGaugeSegment[];
  /** Outer pixel size (square). */
  size?: number;
  /** Stroke width of the ring. */
  stroke?: number;
  /** Stroke color when rendering a single `value` ring. */
  color?: string;
  /** Track (unfilled) color. */
  trackColor?: string;
  /** Add a soft drop-glow under the arc (depth). */
  glow?: boolean;
  /** Center overlay (the big number, etc.). */
  children?: React.ReactNode;
  /** Accessible summary; sets role="img". */
  ariaLabel: string;
  className?: string;
  /** Count-up animation duration in ms. */
  durationMs?: number;
}

/**
 * RingGauge — dependency-free SVG arc gauge with a count-up sweep, optional
 * depth glow, and an optional multi-segment mode (each segment is its own arc
 * around the same circle, so the four Chain-of-Trust layers read as one ring
 * rather than four flat bars). Honors `prefers-reduced-motion` by snapping to
 * the final sweep. Token-driven colors so theme flips just work.
 */
export function RingGauge({
  value = 0,
  segments,
  size = 128,
  stroke = 10,
  color = 'var(--accent)',
  trackColor = 'var(--surface-2)',
  glow = false,
  children,
  ariaLabel,
  className,
  durationMs = 1100
}: RingGaugeProps) {
  const [progress, setProgress] = useState(0); // 0→1 sweep multiplier
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
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setProgress(eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [durationMs]);

  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  // Multi-segment: each layer gets an equal quarter of the ring, filled to its %.
  const segArcs = segments
    ? segments.map((seg, i) => {
        const slot = circumference / segments.length;
        const gap = slot * 0.06; // tiny breathing gap between segments
        const fill = (Math.max(0, Math.min(100, seg.value)) / 100) * (slot - gap) * progress;
        const rotation = (360 / segments.length) * i - 90;
        return { ...seg, slot: slot - gap, fill, rotation, gap };
      })
    : null;

  const singleDash = (Math.max(0, Math.min(100, value)) / 100) * circumference * progress;
  const glowId = `ring-glow-${ariaLabel.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <div
      className={cn('relative', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
        {glow ? (
          <defs>
            <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation={stroke * 0.45} result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
        ) : null}
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
          opacity={0.9}
        />
        {segArcs ? (
          segArcs.map((seg, i) => (
            <g key={i} transform={`rotate(${seg.rotation} ${cx} ${cy})`}>
              {/* per-segment faint track */}
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                opacity={0.16}
                strokeDasharray={`${seg.slot} ${circumference}`}
              />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${seg.fill} ${circumference}`}
                filter={glow ? `url(#${glowId})` : undefined}
              />
            </g>
          ))
        ) : (
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${singleDash} ${circumference}`}
              filter={glow ? `url(#${glowId})` : undefined}
            />
          </g>
        )}
      </svg>
      {children ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default RingGauge;
