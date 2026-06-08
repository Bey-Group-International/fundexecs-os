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
  points: number[];
  tone?: SparklineTone;
  width?: number;
  height?: number;
  area?: boolean;
  /** Stretch to fill the container width (keeps `height`), instead of the
   *  fixed `width`. Useful inside flexible cards/tiles on wide viewports. */
  fluid?: boolean;
  className?: string;
  ariaLabel?: string;
}

/** Sparkline — dependency-free SVG trend line. Tone-matched, area-filled by
 *  default, token-driven stroke so theme flips just work. */
export function Sparkline({
  points,
  tone = 'azure',
  width = 96,
  height = 28,
  area = true,
  fluid = false,
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
      className={cn('block', fluid && 'w-full', className)}
      width={fluid ? undefined : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : undefined}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {area ? <path d={areaPath} fill={stroke} opacity={0.14} stroke="none" /> : null}
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
