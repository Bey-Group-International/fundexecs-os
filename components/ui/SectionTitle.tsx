import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SectionTitleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Tracked-out, all-caps micro-label above the title. */
  eyebrow?: string;
  title: ReactNode;
  /** Optional action node (e.g. a Button) aligned to the title baseline. */
  action?: ReactNode;
}

/**
 * SectionTitle — a section header: optional all-caps eyebrow, an h2-scale
 * title, and an optional trailing action aligned to the baseline.
 */
export function SectionTitle({ eyebrow, title, action, className, ...props }: SectionTitleProps) {
  return (
    <div className={cn('mb-3.5 flex items-end justify-between', className)} {...props}>
      <div>
        {eyebrow && (
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            {eyebrow}
          </div>
        )}
        <h2 className="text-xl font-semibold tracking-[-0.015em] text-fg-1">{title}</h2>
      </div>
      {action}
    </div>
  );
}
