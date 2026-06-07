import Link from 'next/link';
import { ArrowUpRight, Coins } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { RaiseProgress } from '@/lib/queries/dashboard';

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export interface RaiseProgressBarProps {
  progress: RaiseProgress;
  className?: string;
}

/**
 * RaiseProgressBar — committed / soft-circled / target visualized as a
 * single bar. The committed segment fills first, then the soft-circled
 * extension fades on top. Source-badge tells the operator whether they're
 * reading the live allocations rollup or the future capital_stack_summary.
 * Empty state (unsized raise) renders a calm "set a target" CTA.
 */
export function RaiseProgressBar({ progress, className }: RaiseProgressBarProps) {
  const targetSet = progress.target > 0;
  const committedPct = Math.min(100, progress.committedPct);
  const coveragePct = Math.min(100, progress.coveragePct);
  const softPct = Math.max(0, Math.min(100, coveragePct - committedPct));

  return (
    <Card className={cn('p-5', className)} data-testid="raise-progress-bar">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <SectionTitle
          eyebrow={`Capital · source · ${progress.source.replace(/_/g, ' ')}`}
          title="Raise progress"
        />
        {targetSet ? (
          <p className="text-[11.5px] text-fg-3">
            <span className="font-semibold text-fg-1 tabular-nums">
              {money(progress.committed)}
            </span>{' '}
            committed of{' '}
            <span className="font-semibold text-fg-2 tabular-nums">{money(progress.target)}</span>{' '}
            target
          </p>
        ) : (
          <Badge tone="warning" className="text-[10px] uppercase">
            Target not set
          </Badge>
        )}
      </div>

      {!targetSet ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 p-4">
          <p className="text-[12px] text-fg-3">
            Set a target raise in your Profile so Earn can size every move against the goal.
          </p>
          <Link
            href="/profile"
            data-testid="raise-progress-set-target-cta"
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-azure-1 hover:underline"
          >
            Open Profile
            <ArrowUpRight size={11} strokeWidth={2} aria-hidden />
          </Link>
        </div>
      ) : (
        <>
          <div
            className="relative h-3.5 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={coveragePct}
            aria-label={`Raise coverage ${coveragePct}%`}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-l-full bg-success"
              style={{ width: `${committedPct}%` }}
              data-testid="raise-progress-committed"
            />
            <div
              className="absolute inset-y-0 rounded-r-full bg-azure-1 opacity-70"
              style={{ left: `${committedPct}%`, width: `${softPct}%` }}
              data-testid="raise-progress-soft"
            />
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-3">
            <Stat
              dot="bg-success"
              label="Committed"
              value={money(progress.committed)}
              hint={`${progress.committedPct}% of target`}
            />
            <Stat
              dot="bg-azure-1"
              label="Soft-circled"
              value={money(progress.softCircled)}
              hint={`${Math.max(0, coveragePct - committedPct)}% extension`}
            />
            <Stat
              dot="bg-surface-2"
              label="Coverage"
              value={`${coveragePct}%`}
              hint="Committed + soft-circled"
              icon
            />
          </dl>
        </>
      )}
    </Card>
  );
}

function Stat({
  dot,
  label,
  value,
  hint,
  icon
}: {
  dot: string;
  label: string;
  value: string;
  hint: string;
  icon?: boolean;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-bg-1 px-3 py-2">
      <div className="flex items-center gap-1.5">
        {icon ? (
          <Coins size={11} strokeWidth={2} className="text-fg-4" aria-hidden />
        ) : (
          <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dot)} />
        )}
        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">{label}</dt>
      </div>
      <dd className="mt-1 text-[16px] font-semibold tabular-nums tracking-[-0.012em] text-fg-1">
        {value}
      </dd>
      <p className="mt-0.5 truncate text-[10.5px] text-fg-4">{hint}</p>
    </div>
  );
}
