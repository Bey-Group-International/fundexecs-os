import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Uppercase micro-label above titles and decision groups. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4', className)}
    >
      {children}
    </div>
  );
}
