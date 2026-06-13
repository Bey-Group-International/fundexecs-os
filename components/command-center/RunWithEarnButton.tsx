'use client';

import { Sparkles } from 'lucide-react';
import { openEarn } from '@/lib/earn/launcher';

/**
 * RunWithEarnButton — the Command Center hero's "run from the dashboard" action.
 *
 * The ranked desk moves are navigation-only by design (`lib/command-center/
 * moves.ts` never fakes an execution). For the single highest-impact move we
 * still want the prototype's "one tap to run" beat — so this hands the move to
 * Earn (the real streaming COO surface, with approve-before-write confirm
 * cards) as a starting intent. Nothing executes without the operator's
 * approval inside the dock; this only opens it seeded with the move. Styled to
 * match the hero's gold CTA exactly so the visual is unchanged.
 */
export function RunWithEarnButton({
  ask,
  label = 'Run with Earn',
  variant = 'hero'
}: {
  ask: string;
  label?: string;
  /** `hero` is the gold CTA; `compact` is the bordered per-row "Run" button. */
  variant?: 'hero' | 'compact';
}) {
  const cls =
    variant === 'hero'
      ? 'inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#F7C948,#E5A823)] px-4 py-2.5 text-[13.5px] font-semibold text-[#070b14] shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_20px_-8px_rgba(247,201,72,0.55)] transition hover:brightness-105'
      : 'inline-flex flex-none items-center gap-1.5 rounded-xl border border-hairline bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-fg-1 transition hover:bg-surface-3';
  return (
    <button type="button" onClick={() => openEarn({ ask })} className={cls}>
      <Sparkles size={variant === 'hero' ? 15 : 13} aria-hidden />
      {label}
    </button>
  );
}
