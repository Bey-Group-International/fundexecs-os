'use client';

import type { HTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TabItem {
  /** Stable identifier compared against `active`. */
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Optional trailing count shown muted next to the label. */
  count?: number;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  tabs: TabItem[];
  /** The id of the currently active tab. */
  active: string;
  onChange: (id: string) => void;
}

/**
 * SegTabs — a segmented control. Inline pill group on a raised surface; the
 * active segment lifts to a brighter fill with primary text.
 */
export function SegTabs({ tabs, active, onChange, className, ...props }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex gap-0.5 rounded-xl border border-hairline bg-bg-1 p-[3px]',
        className
      )}
      {...props}
    >
      {tabs.map((t) => {
        const on = t.id === active;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition',
              on ? 'bg-surface-3 text-fg-1' : 'text-fg-4 hover:text-fg-2'
            )}
          >
            {Icon && <Icon size={14} strokeWidth={1.9} aria-hidden />}
            {t.label}
            {t.count != null && (
              <span className={cn('text-[11px]', on ? 'text-fg-3' : 'text-fg-5')}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Alias — `Tabs` and `SegTabs` are the same segmented control. */
export const Tabs = SegTabs;
