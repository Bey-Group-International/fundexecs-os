'use client';

import { Badge, Card, SectionTitle } from '@/components/ui';
import { RingGauge } from '@/components/dashboard/RingGauge';
import { Sparkline } from '@/components/dashboard/Sparkline';
import { cn } from '@/lib/utils';
import type { CapitalAccountSummaryData } from './types';

const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

export interface CapitalAccountCardProps {
  summary: CapitalAccountSummaryData;
  /** When true, the data shown is sample/empty-state data. */
  isSample?: boolean;
  className?: string;
}

/**
 * CapitalAccountCard — capital account summary:
 *   committed → called → distributed → NAV
 *
 * A RingGauge shows called-capital utilisation (called / committed × 100).
 * A Sparkline traces the NAV balance series. Both gracefully degrade when
 * data is absent. Sample data is badged to distinguish live from placeholder.
 */
export function CapitalAccountCard({
  summary,
  isSample = false,
  className
}: CapitalAccountCardProps) {
  const callRatio =
    summary.committed > 0 ? Math.min(100, (summary.called / summary.committed) * 100) : 0;

  const dpiRatio =
    summary.called > 0 ? (summary.distributed / summary.called).toFixed(2) + 'x' : '—';

  const hasNav = summary.navBalance !== null;
  const hasSeries = summary.balanceSeries.length >= 2;

  return (
    <Card className={cn('p-5', className)} data-testid="lp-capital-account">
      <div className="mb-4 flex items-start justify-between gap-3">
        <SectionTitle
          eyebrow="Capital account · statement"
          title="Committed → called → distributed"
          className="mb-0"
        />
        {isSample && (
          <Badge tone="warning" className="shrink-0 text-[10px]">
            Sample data
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        {/* Ring gauge — called / committed utilisation */}
        <div className="flex shrink-0 justify-center sm:justify-start">
          <RingGauge
            value={callRatio}
            size={96}
            stroke={9}
            color="var(--accent)"
            trackColor="var(--surface-2)"
            glow
            ariaLabel={`Called capital utilisation: ${callRatio.toFixed(0)}%`}
          >
            <span className="text-[16px] font-semibold tabular-nums tracking-tight text-fg-1">
              {callRatio.toFixed(0)}%
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-4">
              Called
            </span>
          </RingGauge>
        </div>

        {/* Four metrics */}
        <dl className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricCell
            label="Committed"
            value={summary.committed > 0 ? fmt.format(summary.committed) : '—'}
            tone="azure"
          />
          <MetricCell
            label="Called"
            value={summary.called > 0 ? fmt.format(summary.called) : '—'}
            tone="success"
          />
          <MetricCell
            label="Distributed"
            value={summary.distributed > 0 ? fmt.format(summary.distributed) : '—'}
            tone="gold"
          />
          <MetricCell label="DPI" value={dpiRatio} tone="neutral" />
        </dl>
      </div>

      {/* NAV + sparkline row */}
      {(hasNav || hasSeries) && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 shadow-[var(--shadow-sm)]">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
              Current NAV
            </span>
            <p className="mt-0.5 text-[18px] font-semibold tabular-nums tracking-tight text-fg-1">
              {hasNav ? fmt.format(summary.navBalance as number) : '—'}
            </p>
          </div>
          {hasSeries && (
            <Sparkline
              points={summary.balanceSeries}
              tone="azure"
              width={96}
              height={32}
              ariaLabel="NAV balance over time"
            />
          )}
        </div>
      )}
    </Card>
  );
}

function MetricCell({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: 'azure' | 'success' | 'gold' | 'neutral';
}) {
  const toneClass = {
    azure: 'border-[var(--azure-line)] text-azure-1',
    success: 'border-[var(--success-line)] text-success',
    gold: 'border-[var(--gold-line)] text-gold-1',
    neutral: 'border-hairline text-fg-3'
  }[tone];

  return (
    <div
      className={cn('rounded-xl border bg-bg-1 px-3 py-2.5 shadow-[var(--shadow-sm)]', toneClass)}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
        {label}
      </span>
      <p className="mt-1 text-[16px] font-semibold tabular-nums tracking-[-0.015em] text-fg-1">
        {value}
      </p>
    </div>
  );
}
