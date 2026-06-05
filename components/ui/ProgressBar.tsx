import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'color'> {
  /** Completion percentage, 0–100. Clamped to that range. */
  value: number;
  /** Track height in pixels. Defaults to 6. */
  height?: number;
  /** Fill color. Accepts any CSS color; defaults to the gold accent token. */
  color?: string;
  /** A CSS background (e.g. a gradient) that overrides `color` for the fill. */
  gradient?: string;
  /** Accessible name for the bar. Provide a useful default at every call
   * site (e.g. 'Warmth score'). Without it, axe flags the bar as
   * unnamed (aria-progressbar-name). */
  ariaLabel?: string;
}

/**
 * ProgressBar — an animated fill bar. Defaults to the gold reward color and a
 * white-alpha track; the fill width animates on value change.
 */
export function ProgressBar({
  value,
  height = 6,
  color = 'var(--gold-1)',
  gradient,
  className,
  ariaLabel,
  ...props
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel ?? 'Progress'}
      className={cn('w-full overflow-hidden rounded-full bg-white/[0.08]', className)}
      style={{ height }}
      {...props}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%`, background: gradient ?? color }}
      />
    </div>
  );
}
