import { ArrowDownToLine } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import type { DistributionItem } from './types';

const KIND_LABEL: Record<DistributionItem['kind'], string> = {
  return_of_capital: 'Return of capital',
  profit: 'Profit',
  dividend: 'Dividend',
  recallable: 'Recallable',
  special: 'Special',
  other: 'Other'
};

const STATUS_TONE: Record<DistributionItem['status'], BadgeTone> = {
  pending: 'warning',
  paid: 'success',
  cancelled: 'neutral'
};

const STATUS_LABEL: Record<DistributionItem['status'], string> = {
  pending: 'Pending',
  paid: 'Paid',
  cancelled: 'Cancelled'
};

const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

export interface DistributionsFeedProps {
  distributions: DistributionItem[];
  /** When true, the rows shown are sample data (no real DB entries). */
  isSample?: boolean;
  className?: string;
}

/**
 * DistributionsFeed — a reverse-chronological list of distribution events.
 * Each row shows the date, kind chip, amount, status pill, and optional memo.
 * An honest empty state is rendered when there are no distributions; sample
 * data is visually flagged so LPs can distinguish live from placeholder.
 */
export function DistributionsFeed({
  distributions,
  isSample = false,
  className
}: DistributionsFeedProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="lp-distributions-feed">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle
          eyebrow="Distributions · audit-ready"
          title="Capital returned to LPs"
          className="mb-0"
        />
        {isSample && (
          <Badge tone="warning" className="shrink-0 text-[10px]">
            Sample data
          </Badge>
        )}
      </div>

      {distributions.length === 0 ? (
        <EmptyState
          variant="card"
          icon={ArrowDownToLine}
          title="No distributions yet"
          body="Distributions will appear here once capital is returned to LPs."
        />
      ) : (
        <>
          <div
            className="mb-1 hidden grid-cols-[1.4fr_1.2fr_1fr_1fr] gap-3 px-1 sm:grid"
            aria-hidden
          >
            {['Date', 'Kind', 'Amount', 'Status'].map((h) => (
              <span
                key={h}
                className="text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-5"
              >
                {h}
              </span>
            ))}
          </div>
          <ul className="flex flex-col">
            {distributions.map((d) => (
              <li
                key={d.id}
                data-testid={`lp-distribution-${d.id}`}
                className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-0.5 rounded-xl px-1 py-2.5 transition-colors hover:bg-surface-1 sm:grid-cols-[1.4fr_1.2fr_1fr_1fr] sm:items-center"
              >
                {/* Date */}
                <span className="text-[12px] tabular-nums text-fg-3">{d.distributionDate}</span>

                {/* Kind */}
                <span className="hidden text-[11.5px] text-fg-3 sm:block">
                  {KIND_LABEL[d.kind]}
                </span>

                {/* Amount */}
                <span className="text-[13px] font-semibold tabular-nums text-fg-1">
                  {fmt.format(d.amount)}
                </span>

                {/* Status + memo */}
                <div className="flex flex-col gap-0.5 sm:items-start">
                  <Badge
                    tone={STATUS_TONE[d.status]}
                    className="justify-self-start text-[10px] uppercase"
                  >
                    {STATUS_LABEL[d.status]}
                  </Badge>
                  {d.memo ? (
                    <span className="mt-0.5 text-[10.5px] text-fg-4 sm:mt-0">{d.memo}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
