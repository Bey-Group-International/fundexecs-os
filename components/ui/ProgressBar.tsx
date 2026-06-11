import { cn } from '@/lib/utils';

export interface ProgressBarProps {
  /** 0–100; values outside the range are clamped. */
  value: number;
  /** Track height in pixels. */
  height?: number;
  /** Fill style: gold gradient (readiness) or flat accent/neutral. */
  tone?: 'gold' | 'accent' | 'neutral';
  className?: string;
  /** Accessible label; omit to render decorative (aria-hidden). */
  label?: string;
}

const FILLS: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  gold: 'bg-[linear-gradient(90deg,#F7C948,#E5A823)]',
  accent: 'bg-accent',
  neutral: 'bg-fg-5'
};

/** Hairline progress track — the prototype's readiness fill. Width-only motion. */
export function ProgressBar({
  value,
  height = 4,
  tone = 'gold',
  className,
  label
}: ProgressBarProps) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-surface-2', className)}
      style={{ height }}
      {...(label
        ? {
            role: 'progressbar',
            'aria-label': label,
            'aria-valuenow': pct,
            'aria-valuemin': 0,
            'aria-valuemax': 100
          }
        : { 'aria-hidden': true })}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', FILLS[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
