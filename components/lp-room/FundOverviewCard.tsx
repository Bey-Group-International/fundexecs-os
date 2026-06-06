import { TrendingUp, Calendar, Coins, Target, ChartLine } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { FundOverview, FundStatus } from './types';

const STATUS_TONE: Record<FundStatus, BadgeTone> = {
  open: 'success',
  'in-market': 'azure',
  closed: 'neutral',
  'wound-down': 'neutral'
};

const STATUS_LABEL: Record<FundStatus, string> = {
  open: 'Open',
  'in-market': 'In market',
  closed: 'Closed',
  'wound-down': 'Wound down'
};

export interface FundOverviewCardProps {
  fund: FundOverview;
  className?: string;
}

/**
 * FundOverviewCard — top-of-room hero card. Eleanor's voice in the eyebrow,
 * fund name as h1, status pill, six tabular metrics in a tone-matched grid.
 * Solid `bg-bg-1` everywhere so legibility holds without dipping into the
 * deprecated translucent surface pattern.
 */
export function FundOverviewCard({ fund, className }: FundOverviewCardProps) {
  return (
    <Card
      data-testid="lp-fund-overview"
      className={cn('relative overflow-hidden p-[18px]', className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: 'radial-gradient(70% 130% at 0% 0%, rgba(91,141,239,0.10), transparent 60%)'
        }}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            Eleanor · Head of Investor Relations · on the record
          </p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.018em] text-fg-1 sm:text-[26px]">
            {fund.name}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-fg-3">
            Vintage {fund.vintage} · {fund.strategy}
          </p>
          {fund.oneLiner ? (
            <p className="mt-2 max-w-[60ch] text-[12.5px] text-fg-3">{fund.oneLiner}</p>
          ) : null}
        </div>
        <Badge tone={STATUS_TONE[fund.status]} dot className="text-[10.5px]">
          {STATUS_LABEL[fund.status]}
        </Badge>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Target" value={fund.sizeTarget} icon={Target} />
        <Metric label="Committed" value={fund.committed} icon={TrendingUp} />
        <Metric label="Called" value={fund.called} icon={Coins} />
        <Metric label="DPI" value={fund.dpi ?? '—'} icon={ChartLine} />
        <Metric label="TVPI" value={fund.tvpi ?? '—'} icon={ChartLine} />
        <Metric label="Net IRR" value={fund.irr ?? '—'} icon={ChartLine} />
      </dl>

      {fund.nextClose ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-azure-1">
          <Calendar size={12} strokeWidth={2} aria-hidden />
          Next close · {fund.nextClose}
        </div>
      ) : null}

      <SectionTitle eyebrow="Audit posture" title="Documented as it forms" className="mt-5" />
      <p className="mt-1 max-w-[64ch] text-[12px] text-fg-3">
        Every commitment, capital call, and distribution is recorded with a signed artifact in the
        Vault. Nothing is asserted here that cannot be shown.
      </p>
    </Card>
  );
}

function Metric({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: typeof Coins;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 shadow-[var(--shadow-sm)]">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
        <Icon size={11} strokeWidth={2} aria-hidden />
        {label}
      </span>
      <span className="text-[18px] font-semibold tabular-nums tracking-[-0.015em] text-fg-1">
        {value}
      </span>
    </div>
  );
}
