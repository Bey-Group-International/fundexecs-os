import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Optional centered icon — a tile in `page`, a plain glyph in `card`. */
  icon?: LucideIcon;
  title: string;
  body: string;
  /** Optional CTA slot — e.g. a Button. */
  action?: React.ReactNode;
  /**
   * Layout:
   *  • `page` (default) — a full, borderless zero-data placeholder for an empty
   *    screen or section: large centered icon tile, generous padding.
   *  • `card` — a compact, dashed-bordered hint sized to sit inside a small feed
   *    or list card.
   */
  variant?: 'page' | 'card';
  className?: string;
}

/**
 * EmptyState — tasteful zero-data placeholder.
 *
 * Centered icon + title + body + optional action, in one of two sizes so every
 * empty surface reads consistently: `page` for an empty screen/section, `card`
 * for a compact in-card hint (feeds, lists). Tokens-only styling.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  variant = 'page',
  className
}: EmptyStateProps) {
  if (variant === 'card') {
    return (
      <div
        className={cn(
          'rounded-xl border border-dashed border-hairline bg-surface-1 p-6 text-center',
          className
        )}
      >
        {Icon ? (
          <Icon size={20} strokeWidth={1.5} className="mx-auto mb-2 text-fg-5" aria-hidden />
        ) : null}
        <p className="text-[12.5px] font-medium text-fg-2">{title}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-fg-4">{body}</p>
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      {Icon ? (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-surface-1 text-fg-4"
          aria-hidden
        >
          <Icon size={22} strokeWidth={1.6} />
        </span>
      ) : null}
      <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-fg-1">{title}</h3>
      <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-fg-4">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
