import type { BadgeTone } from '@/components/ui';
import { TONE_HEX } from '@/components/screens/tone';

export interface SparklineProps {
  /** Series of values used to draw the trend line. */
  points: number[];
  tone?: BadgeTone;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Sparkline — a tiny inline trend chart for KPI cards. Presentational: renders
 * a smooth polyline plus a soft area fill tinted to the given design tone.
 */
export function Sparkline({
  points,
  tone = 'azure',
  width = 96,
  height = 36,
  className
}: SparklineProps) {
  const stroke = TONE_HEX[tone];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1 || 1);

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });

  const line = coords
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const gradientId = `spark-${tone}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
