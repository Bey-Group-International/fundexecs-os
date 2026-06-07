import Link from 'next/link';
import { ArrowUpRight, IdCard } from 'lucide-react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { FundProfile } from '@/lib/queries/fund-profile';

export interface FundProfileRailSummaryProps {
  profile: FundProfile;
  /** Where the compact summary navigates to on click — defaults to /profile. */
  href?: string;
  className?: string;
}

/**
 * FundProfileRailSummary — a compact summary card meant for embedding in
 * the side-rail's Source-of-Truth area (or any narrow surface). Fund name,
 * tier, completeness bar, and the top gap label. Click-through opens the
 * full Fund Profile.
 */
export function FundProfileRailSummary({
  profile,
  href = '/profile',
  className
}: FundProfileRailSummaryProps) {
  const topGap = profile.gaps[0];
  return (
    <Link
      href={href}
      data-testid="fund-profile-rail-summary"
      className={cn(
        'group flex items-start gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 transition-[background,transform,box-shadow] hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-sm)]',
        className
      )}
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-gold-1">
        <IdCard size={14} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[12px] font-semibold text-fg-1">{profile.fundName}</p>
          <span className="text-[10px] font-semibold tabular-nums text-gold-1">
            {profile.completenessScore}%
          </span>
        </div>
        <p className="mt-0.5 truncate text-[10.5px] text-fg-4">
          {topGap ? `Gap · ${topGap.label}` : 'On the record · audit-ready'}
        </p>
        <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-gold-1"
            style={{ width: `${profile.completenessScore}%` }}
          />
        </div>
      </div>
      <ArrowUpRight
        size={12}
        strokeWidth={2}
        className="mt-1 flex-none text-fg-5 transition-transform group-hover:translate-x-0.5 group-hover:text-azure-1"
        aria-hidden
      />
    </Link>
  );
}

/** Tiny renderer for when a fund profile isn't available yet. */
export function FundProfileRailSummaryEmpty({
  href = '/profile',
  className
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Card data-testid="fund-profile-rail-summary-empty" className={cn('p-3', className)}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
        Source of Truth
      </p>
      <p className="mt-1 text-[12px] text-fg-3">
        Set up your Fund Profile to surface readiness everywhere.
      </p>
      <Link
        href={href}
        className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-azure-1 hover:underline"
      >
        Start profile
        <ArrowUpRight size={11} strokeWidth={2} aria-hidden />
      </Link>
    </Card>
  );
}
