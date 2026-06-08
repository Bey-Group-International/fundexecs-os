'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Flame, RefreshCw, ArrowUpRight } from 'lucide-react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';

/* ============================================================================
 * GameBits — the small interactive gamification pieces for the Command Center:
 * an Earn-coin incentive strip tied to the next move, and a "Regenerate" button
 * that re-runs the dashboard loader (router.refresh).
 * ========================================================================= */

export function EarnCoinIncentive({
  reward,
  streak,
  nextHref,
  nextLabel
}: {
  /** Earn coins credited when the next move is completed. */
  reward: number;
  streak: number;
  nextHref: string | null;
  nextLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3">
      <div className="flex items-center gap-3">
        <EarnCoin size={30} glow />
        <div className="text-[12.5px] text-fg-2">
          Complete your next move to earn{' '}
          <span className="font-semibold text-gold-1">+{reward} Earn coins</span>
          {streak > 0 ? (
            <span className="ml-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-warning">
              <Flame size={12} strokeWidth={2.2} aria-hidden />
              {streak}-day streak
            </span>
          ) : null}
        </div>
      </div>
      {nextHref ? (
        <Link
          href={nextHref}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_8px_18px_-8px_rgba(37,99,235,0.6)] transition hover:brightness-110"
        >
          {nextLabel}
          <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

export function RegenerateButton({ label = 'Regenerate' }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-1 px-2.5 py-1.5 text-[11.5px] font-medium text-fg-3 transition hover:bg-surface-2 hover:text-fg-1 disabled:opacity-60"
    >
      <RefreshCw size={13} strokeWidth={2} className={cn(pending && 'animate-spin')} aria-hidden />
      {pending ? 'Refreshing…' : label}
    </button>
  );
}
