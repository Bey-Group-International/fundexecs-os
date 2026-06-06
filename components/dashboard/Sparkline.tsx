import { cn } from '@/lib/utils';

export type SparklineTone = 'azure' | 'gold' | 'success' | 'warning' | 'danger' | 'neutral';

const TONE_STROKE: Record<SparklineTone, string> = {
  azure: 'var(--accent)',
  gold: 'var(--gold-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  neutral: 'var(--fg-4)'
};

export interface SparklineProps {
  /** 4–24 numeric points. Auto-scaled vertically to fit the box. */
  points: number[];
  /** Tone selects stroke + fill color (token-driven). */
  tone?: SparklineTone;
  /** Width in pixels — defaults to 96. Height is fixed at 28. */
  width?: number;
  /** Height in pixels — defaults to 28. */
  height?: number;
  /** Adds a soft area fill below the line when `true` (default). */
  area?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * Sparkline — a tiny, dependency-free SVG line graph used inside KPI tiles
 * to convey trend at a glance. Tone-matched to the parent tile, with an
 * optional area-fill underneath. Color is referenced via design tokens so
 * theme flips just work.
 */
export function Sparkline({
  points,
  tone = 'azure',
  width = 96,
  height = 28,
  area = true,
  className,
  ariaLabel
}: SparklineProps) {
  if (!points.length) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;

  const path = points
    .map((y, i) => {
      const px = i * stepX;
      const py = height - ((y - min) / span) * height;
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`;
    })
    .join(' ');

  const areaPath = `${path} L${(points.length - 1) * stepX} ${height} L0 ${height} Z`;
  const stroke = TONE_STROKE[tone];

  return (
    <svg
      className={cn('block', className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {area && (
        <path d={areaPath} fill={stroke} opacity={0.14} stroke="none" />
      )}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
