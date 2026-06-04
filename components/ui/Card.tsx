import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds a smooth hover-lift and pointer cursor for interactive cards. */
  clickable?: boolean;
}

/**
 * Card — the atomic surface. Hairline border, white-alpha fill, soft shadow
 * and a 1px top highlight. `clickable` adds a hover-lift for interactive cards.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { clickable = false, className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl border border-hairline bg-surface-1 p-5 shadow-[var(--shadow-md)] transition',
        clickable &&
          'cursor-pointer hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-lg)]',
        className
      )}
      {...props}
    />
  );
});
