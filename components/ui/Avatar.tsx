import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type AvatarTone = 'neutral' | 'gold' | 'azure' | 'success' | 'warning' | 'danger' | 'info';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** Full name; up to the first two initials are derived and shown. */
  name: string;
  /** Square size in pixels. Radius and font scale from this. Defaults to 32. */
  size?: number;
  tone?: AvatarTone;
}

const TONE_CLASSES: Record<AvatarTone, string> = {
  neutral: 'text-fg-3 bg-surface-2 border-hairline',
  gold: 'text-gold-1 bg-[var(--gold-soft)] border-[var(--gold-line)]',
  azure: 'text-azure-1 bg-[var(--azure-soft)] border-[var(--azure-line)]',
  success: 'text-success bg-[var(--success-soft)] border-[var(--success-line)]',
  warning: 'text-warning bg-[var(--warning-soft)] border-[var(--warning-line)]',
  danger: 'text-danger bg-[var(--danger-soft)] border-[var(--danger-line)]',
  info: 'text-info bg-[var(--info-soft)] border-[var(--info-line)]'
};

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Avatar — initials in a tinted, rounded-square chip. Tone-tinted to match the
 * badge palette; size drives the radius and font size.
 */
export function Avatar({
  name,
  size = 32,
  tone = 'azure',
  className,
  style,
  ...props
}: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center justify-center border font-semibold',
        TONE_CLASSES[tone],
        className
      )}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        fontSize: size * 0.38,
        ...style
      }}
      {...props}
    >
      {initialsOf(name)}
    </span>
  );
}
