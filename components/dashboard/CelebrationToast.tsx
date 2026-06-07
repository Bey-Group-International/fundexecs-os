'use client';

import { useEffect, useState } from 'react';
import { Award, Flame, Trophy, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CelebrationKind = 'level-up' | 'streak' | 'badge';

export interface Celebration {
  kind: CelebrationKind;
  title: string;
  detail: string;
}

const KIND_META: Record<CelebrationKind, { icon: typeof Zap; eyebrow: string }> = {
  'level-up': { icon: Zap, eyebrow: 'Level up' },
  streak: { icon: Flame, eyebrow: 'New streak high' },
  badge: { icon: Award, eyebrow: 'Achievement earned' }
};

export interface CelebrationToastProps {
  /**
   * The celebration to show. Pass `null` for none. When it changes to a
   * non-null value the toast animates in once, then auto-settles. Honest,
   * single-moment — no confetti spam.
   */
  celebration: Celebration | null;
  /** Called when the toast is dismissed (manually or on auto-settle). */
  onDone?: () => void;
  /** Auto-settle window. */
  dismissMs?: number;
}

/**
 * CelebrationToast — a refined, single-moment reward toast for level-ups, new
 * streak highs, and earned badges. Gold-accented (reward = gold, per the design
 * lint). Bottom-center, above content. Reduced-motion safe: the celebratory
 * float/glow is CSS-guarded and the toast simply appears/leaves without motion.
 */
export function CelebrationToast({ celebration, onDone, dismissMs = 5200 }: CelebrationToastProps) {
  // Track which celebration the user has dismissed so we can render directly off
  // the prop (no prop→state mirror, which the React-compiler lint flags).
  const [dismissed, setDismissed] = useState<Celebration | null>(null);

  // Auto-settle timer. setState only fires inside the async callback, never
  // synchronously in the effect body.
  useEffect(() => {
    if (!celebration) return;
    const id = setTimeout(() => {
      setDismissed(celebration);
      onDone?.();
    }, dismissMs);
    return () => clearTimeout(id);
  }, [celebration, dismissMs, onDone]);

  const active = celebration && celebration !== dismissed ? celebration : null;
  if (!active) return null;
  const meta = KIND_META[active.kind];
  const Icon = meta.icon;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[96px] z-[60] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div
        className="fx-celebrate pointer-events-auto relative flex w-full max-w-[360px] items-center gap-3 overflow-hidden rounded-2xl border border-[var(--gold-line)] bg-bg-2 p-4 shadow-[var(--shadow-lg)]"
        data-testid="celebration-toast"
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: 'var(--cta-gradient, var(--gold-1))' }}
        />
        <span
          aria-hidden
          className="fx-celebrate-glow flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-[var(--gold-soft)] text-gold-1"
        >
          <Icon size={20} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-1">
            <Trophy size={11} strokeWidth={2} aria-hidden />
            {meta.eyebrow}
          </p>
          <p className="mt-0.5 truncate text-[14px] font-semibold tracking-[-0.01em] text-fg-1">
            {active.title}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg-3">
            {active.detail}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDismissed(active);
            onDone?.();
          }}
          aria-label="Dismiss celebration"
          className={cn(
            'flex h-7 w-7 flex-none items-center justify-center rounded-lg text-fg-5',
            'transition hover:bg-surface-2 hover:text-fg-1'
          )}
        >
          <X size={15} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export default CelebrationToast;
