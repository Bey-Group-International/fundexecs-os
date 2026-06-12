'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The selectable chip primitive shared by the copiloted builders (the
 * prototype's GovChip) — radio/multi decision options across the Build flows.
 */
export function Chip({
  label,
  selected,
  onClick,
  size = 'md'
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  /** `lg` is the onboarding wizard's roomier variant. */
  size?: 'md' | 'lg';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium transition',
        size === 'lg' ? 'px-3.5 py-2 text-[13px]' : 'px-3 py-1.5 text-[12.5px]',
        selected
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
          : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2'
      )}
    >
      {selected && <Check size={12} strokeWidth={2.4} aria-hidden />}
      {label}
    </button>
  );
}
