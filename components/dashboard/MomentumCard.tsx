import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Sparkline } from './Sparkline';
import type { Momentum } from '@/lib/queries/dashboard';

export interface MomentumCardProps {
  momentum: Momentum;
  className?: string;
}

const compactMoney = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 1
});

/**
 * MomentumCard — the raise/portfolio momentum sparkline. Cumulative committed
 * capital over the last 8 weeks with a period-over-period delta. Renders
 * nothing when there's no committed capital yet, so the canvas stays honest.
 */
export function MomentumCard({ momentum, className }: MomentumCardProps) {
  if (!momentum.points.length) return null;
  const latest = momentum.points[momentum.points.length - 1] ?? 0;
  const up = (momentum.deltaPct ?? 0) >= 0;
  const Trend = up ? TrendingUp : TrendingDown;

  return (
    <Card className={cn('fx-rise p-5', className)} data-testid="momentum-card">
      <SectionTitle eyebrow="Momentum" title={momentum.label} className="mb-3" />
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[28px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-fg-1">
            {compactMoney.format(latest)}
          </p>
          {momentum.deltaPct != null ? (
            <span
              className={cn(
                'mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold',
                up
                  ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                  : 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger'
              )}
            >
              <Trend size={11} strokeWidth={2.2} aria-hidden />
              {up ? '+' : ''}
              {momentum.deltaPct}% over period
            </span>
          ) : (
            <p className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-4">
              Building
            </p>
          )}
        </div>
        <Sparkline
          points={momentum.points}
          tone={momentum.tone === 'neutral' ? 'neutral' : up ? 'success' : 'warning'}
          width={132}
          height={44}
          ariaLabel={`${momentum.label} trend`}
        />
      </div>
    </Card>
  );
}

export default MomentumCard;
