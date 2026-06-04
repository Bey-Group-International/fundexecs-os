import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'gold' | 'azure' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Render a leading status dot tinted to the tone. */
  dot?: boolean;
  /** Animate the dot with a gentle pulse (for live "Synergy alert" status). */
  pulse?: boolean;
  children?: ReactNode;
}

/** Per-tone text/fill/border classes driven by the design tokens. */
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'text-fg-3 bg-surface-2 border-hairline',
  gold: 'text-gold-1 bg-[var(--gold-soft)] border-[var(--gold-line)]',
  azure: 'text-azure-1 bg-[var(--azure-soft)] border-[var(--azure-line)]',
  success: 'text-success bg-[var(--success-soft)] border-[var(--success-line)]',
  warning: 'text-warning bg-[var(--warning-soft)] border-[var(--warning-line)]',
  danger: 'text-danger bg-[var(--danger-soft)] border-[var(--danger-line)]',
  info: 'text-info bg-[var(--info-soft)] border-[var(--info-line)]'
};

const DOT_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-fg-3',
  gold: 'bg-gold-1',
  azure: 'bg-azure-1',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info'
};

/**
 * Badge — a small tinted status chip. Fully rounded, 11.5px semibold label,
 * optional leading dot with an optional pulse animation.
 */
export function Badge({
  tone = 'neutral',
  dot = false,
  pulse = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border text-[11.5px] font-semibold',
        dot ? 'py-1 pl-2 pr-2.5' : 'px-2.5 py-1',
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', DOT_TONE[tone], pulse && 'animate-pulse')}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
