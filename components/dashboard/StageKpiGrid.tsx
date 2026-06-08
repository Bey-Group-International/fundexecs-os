import Link from 'next/link';
import { ArrowUpRight, Briefcase, Coins, Target, type LucideIcon } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { LifecycleStage } from '@/lib/lifecycle';
import type { StageKpi } from '@/lib/queries/dashboard';
import { Sparkline, type SparklineTone } from './Sparkline';

/* Format a raw value per the `format` hint. Pure, deterministic — SSR-safe. */
function formatValue(value: number, format: StageKpi['format']): string {
  if (format === 'percent') return `${Math.round(value)}%`;
  if (format === 'money') {
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  return value.toLocaleString();
}

/** Deterministic placeholder trend curves — stable across SSR/CSR. Real
 *  trend data lands when Codex's stage-KPI history seam ships. */
const TREND_CURVES: number[][] = [
  [4, 5, 5, 6, 6, 7, 7, 8, 7, 9],
  [10, 11, 10, 12, 13, 12, 14, 15, 16, 17],
  [3, 4, 5, 4, 6, 7, 8, 8, 9, 11],
  [8, 9, 9, 10, 10, 11, 12, 12, 13, 14]
];

const TONE_BY_FORMAT: Record<StageKpi['format'], SparklineTone> = {
  percent: 'azure',
  money: 'success',
  count: 'azure'
};

const ICON_BY_KEY_PREFIX: Record<string, LucideIcon> = {
  pipeline: Briefcase,
  active: Briefcase,
  in: Briefcase,
  committed: Coins,
  capital: Coins,
  warm: Target,
  hot: Target,
  contacted: Target,
  profile: Target,
  open: Target,
  soft: Coins,
  coverage: Coins,
  completed: Briefcase,
  sourcing: Briefcase
};

function iconFor(kpi: StageKpi): LucideIcon {
  const prefix = kpi.key.split('-')[0];
  return ICON_BY_KEY_PREFIX[prefix] ?? Target;
}

/** Where each KPI tile drills into, keyed by its `key` prefix. */
const HREF_BY_KEY_PREFIX: Record<string, string> = {
  pipeline: '/pipeline',
  active: '/pipeline',
  in: '/pipeline',
  sourcing: '/pipeline',
  open: '/pipeline',
  warm: '/pipeline',
  hot: '/pipeline',
  contacted: '/pipeline',
  committed: '/capital-stack',
  capital: '/capital-stack',
  soft: '/capital-stack',
  coverage: '/capital-stack',
  completed: '/capital-stack',
  profile: '/profile'
};

function hrefFor(kpi: StageKpi): string {
  const prefix = kpi.key.split('-')[0];
  return HREF_BY_KEY_PREFIX[prefix] ?? '/pipeline';
}

export interface StageKpiGridProps {
  stage: LifecycleStage;
  kpis: StageKpi[];
  className?: string;
}

/**
 * StageKpiGrid — three to four lifecycle-aware KPI tiles that change with
 * the current stage. Loader (`buildStageKpis`) selects which counts/values
 * matter; this component renders them with tone-matched sparklines and a
 * lightweight icon. Trend curves are deterministic placeholders until a
 * stage-KPI history seam ships.
 */
export function StageKpiGrid({ stage, kpis, className }: StageKpiGridProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="stage-kpi-grid">
      <SectionTitle
        eyebrow={`Stage focus · ${stage.replace(/_/g, ' ')}`}
        title="What to measure right now"
        className="mb-3"
      />
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi, idx) => {
          const Icon = iconFor(kpi);
          const tone = TONE_BY_FORMAT[kpi.format];
          const trend = TREND_CURVES[idx % TREND_CURVES.length];
          return (
            <li key={kpi.key}>
              <Link
                href={hrefFor(kpi)}
                data-testid={`stage-kpi-${kpi.key}`}
                aria-label={`${kpi.label}: ${formatValue(kpi.value, kpi.format)} — open`}
                className="group block overflow-hidden rounded-xl border border-hairline bg-bg-1 p-3.5 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-azure-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words text-[10.5px] font-semibold uppercase leading-tight tracking-[0.1em] text-fg-4">
                    {kpi.label}
                  </span>
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md border border-hairline bg-surface-1 text-fg-3 transition group-hover:border-[var(--azure-line)] group-hover:text-azure-1">
                    <Icon size={12} strokeWidth={2} className="group-hover:hidden" aria-hidden />
                    <ArrowUpRight
                      size={12}
                      strokeWidth={2}
                      className="hidden group-hover:block"
                      aria-hidden
                    />
                  </span>
                </div>
                <p className="mt-2 text-[22px] font-semibold tabular-nums tracking-[-0.018em] text-fg-1">
                  {formatValue(kpi.value, kpi.format)}
                </p>
                {kpi.hint ? (
                  <p className="mt-0.5 truncate text-[10.5px] text-fg-4">{kpi.hint}</p>
                ) : null}
                <div className="mt-2 opacity-90">
                  <Sparkline
                    points={trend}
                    tone={tone}
                    height={22}
                    fluid
                    ariaLabel={`${kpi.label} trend`}
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
