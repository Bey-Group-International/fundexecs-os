'use client';

import {
  PieChart,
  Users,
  DollarSign,
  Layers,
  ChevronDown,
  ChevronUp,
  type LucideIcon
} from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, ProgressBar, SectionTitle, type BadgeTone } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import type { CapTableData, CapTableEntry } from '@/lib/queries/cap-table';

/* ---- Formatting helpers ------------------------------------------------- */

function money(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(n);
}

function units(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

function pct(n: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, (n / total) * 100);
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

/* ---- Label formatters --------------------------------------------------- */

function holderTypeLabel(t: string): string {
  const map: Record<string, string> = {
    founder: 'Founder',
    investor: 'Investor',
    option_pool: 'Option Pool',
    safe: 'SAFE',
    warrant: 'Warrant',
    other: 'Other'
  };
  return map[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function securityTypeLabel(t: string): string {
  const map: Record<string, string> = {
    common: 'Common',
    preferred: 'Preferred',
    safe: 'SAFE',
    option: 'Option',
    warrant: 'Warrant',
    note: 'Note',
    other: 'Other'
  };
  return map[t] ?? t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---- Badge tones -------------------------------------------------------- */

function holderTypeTone(t: string): BadgeTone {
  const map: Record<string, BadgeTone> = {
    founder: 'gold',
    investor: 'azure',
    option_pool: 'info',
    safe: 'warning',
    warrant: 'neutral',
    other: 'neutral'
  };
  return map[t] ?? 'neutral';
}

function securityTypeTone(t: string): BadgeTone {
  const map: Record<string, BadgeTone> = {
    common: 'success',
    preferred: 'azure',
    safe: 'warning',
    option: 'info',
    warrant: 'neutral',
    note: 'danger',
    other: 'neutral'
  };
  return map[t] ?? 'neutral';
}

/* ---- Token color palette for donut segments ----------------------------- */

const DONUT_COLORS = [
  'var(--azure-1)',
  'var(--gold-1)',
  'var(--success)',
  'var(--info)',
  'var(--warning)',
  'var(--danger)',
  'var(--fg-4)'
];

const TONE_VAR: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};

/* ---- KPI tile ----------------------------------------------------------- */

function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral'
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: BadgeTone;
}) {
  return (
    <Card className="relative overflow-hidden p-4">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: TONE_VAR[tone] }}
      />
      <div className="flex items-center justify-between">
        <dt className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          {label}
        </dt>
        <span style={{ color: TONE_VAR[tone] }}>
          <Icon size={15} strokeWidth={1.9} aria-hidden />
        </span>
      </div>
      <dd className="mt-2 text-[22px] font-semibold tabular-nums tracking-[-0.015em] text-fg-1">
        {value}
      </dd>
      {hint ? <p className="mt-0.5 text-[11px] text-fg-4">{hint}</p> : null}
    </Card>
  );
}

/* ---- Ownership donut ---------------------------------------------------- */

function OwnershipDonut({ breakdown }: { breakdown: Array<[string, number]> }) {
  const total = breakdown.reduce((sum, [, v]) => sum + v, 0);
  const radius = 52;
  const stroke = 18;
  const circumference = 2 * Math.PI * radius;

  const segments = breakdown.map(([label, value], i) => {
    const fraction = total > 0 ? value / total : 0;
    const priorSum = breakdown.slice(0, i).reduce((sum, [, v]) => sum + v, 0);
    return {
      label,
      value,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      dash: fraction * circumference,
      gap: circumference - fraction * circumference,
      rotation: (priorSum / (total || 1)) * 360
    };
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="relative flex-none">
        <svg
          width={140}
          height={140}
          viewBox="0 0 140 140"
          role="img"
          aria-label="Ownership breakdown donut"
        >
          <circle
            cx={70}
            cy={70}
            r={radius}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth={stroke}
          />
          {segments.map((seg) => (
            <circle
              key={seg.label}
              cx={70}
              cy={70}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={`${seg.dash} ${seg.gap}`}
              strokeDashoffset={0}
              transform={`rotate(${seg.rotation - 90} 70 70)`}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-4">
            F-D
          </span>
          <span className="text-[13px] font-semibold tabular-nums text-fg-1">{fmtPct(total)}</span>
        </div>
      </div>
      <ul className="flex w-full flex-1 flex-col gap-2">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2.5 text-[12.5px]">
            <span
              aria-hidden
              className="h-2.5 w-2.5 flex-none rounded-[3px]"
              style={{ background: seg.color }}
            />
            <span className="min-w-0 flex-1 truncate text-fg-2">{holderTypeLabel(seg.label)}</span>
            <span className="flex-none tabular-nums text-fg-2">{fmtPct(seg.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---- Stacked-bar breakdown row ----------------------------------------- */

function BreakdownRow({
  label,
  value,
  total,
  color
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const p = pct(value, total);
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 flex-none truncate text-[12.5px] text-fg-2">
        {holderTypeLabel(label)}
      </div>
      <ProgressBar
        value={p}
        height={5}
        color={color}
        ariaLabel={`${holderTypeLabel(label)} ownership`}
        className="flex-1"
      />
      <div className="w-16 flex-none text-right text-[12.5px] tabular-nums text-fg-2">
        {fmtPct(value)}
      </div>
    </div>
  );
}

/* ---- Holdings table ----------------------------------------------------- */

function HoldingsTable({ entries }: { entries: CapTableEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, 10);

  if (entries.length === 0) return null;

  return (
    <div>
      <SectionTitle
        eyebrow="Cap Table"
        title="Holdings"
        action={
          <Badge tone="neutral" className="text-[10.5px]">
            {entries.length} {entries.length === 1 ? 'holder' : 'holders'}
          </Badge>
        }
      />
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-hairline bg-surface-1">
                <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-[0.09em] text-fg-4">
                  Holder
                </th>
                <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-[0.09em] text-fg-4">
                  Type
                </th>
                <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-[0.09em] text-fg-4">
                  Security
                </th>
                <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-[0.09em] text-fg-4">
                  Units
                </th>
                <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-[0.09em] text-fg-4">
                  Ownership
                </th>
                <th className="hidden px-4 py-2.5 text-right font-semibold uppercase tracking-[0.09em] text-fg-4 sm:table-cell">
                  Invested
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry, i) => (
                <tr
                  key={entry.id}
                  className={cn(
                    'border-b border-hairline last:border-0',
                    i % 2 === 0 ? 'bg-transparent' : 'bg-surface-1/40'
                  )}
                >
                  <td className="px-4 py-2.5 font-medium text-fg-1">{entry.holderName}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={holderTypeTone(entry.holderType)} className="text-[10.5px]">
                      {holderTypeLabel(entry.holderType)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={securityTypeTone(entry.securityType)} className="text-[10.5px]">
                      {securityTypeLabel(entry.securityType)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-fg-2">
                    {units(entry.units)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-fg-2">
                    {entry.ownershipPct !== null ? (
                      fmtPct(entry.ownershipPct)
                    ) : (
                      <span className="text-fg-5">—</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 text-right tabular-nums text-fg-3 sm:table-cell">
                    {entry.amountInvested !== null ? (
                      money(entry.amountInvested)
                    ) : (
                      <span className="text-fg-5">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length > 10 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-hairline py-2.5 text-[12px] font-medium text-fg-3 transition hover:bg-surface-1 hover:text-fg-1"
          >
            {expanded ? (
              <>
                <ChevronUp size={14} strokeWidth={1.9} aria-hidden />
                Show less
              </>
            ) : (
              <>
                <ChevronDown size={14} strokeWidth={1.9} aria-hidden />
                Show all {entries.length} holders
              </>
            )}
          </button>
        ) : null}
      </Card>
    </div>
  );
}

/* ---- Main view ---------------------------------------------------------- */

export interface CapTableViewProps {
  data: CapTableData;
}

export function CapTableView({ data }: CapTableViewProps) {
  const { entries, summary, empty } = data;

  if (empty) {
    return (
      <EmptyState
        icon={PieChart}
        title="No cap table entries yet"
        body="Add holder entries — founders, investors, option pools, and SAFEs — to see the fully-diluted ownership breakdown and holdings table here."
      />
    );
  }

  const breakdownEntries = Object.entries(summary.ownershipByType)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  const breakdownTotal = breakdownEntries.reduce((sum, [, v]) => sum + v, 0);

  return (
    <div className="space-y-8">
      {/* KPI tiles */}
      <section aria-label="Cap table summary">
        <SectionTitle eyebrow="Ownership" title="Summary" />
        <dl className="grid gap-3 sm:grid-cols-3">
          <KpiTile
            label="Total Units"
            value={units(summary.totalUnits)}
            hint="Fully-diluted share count"
            icon={Layers}
            tone="azure"
          />
          <KpiTile
            label="Holders"
            value={String(entries.length)}
            hint={`${breakdownEntries.length} holder type${breakdownEntries.length === 1 ? '' : 's'}`}
            icon={Users}
            tone="neutral"
          />
          <KpiTile
            label="Total Invested"
            value={summary.totalInvested > 0 ? money(summary.totalInvested) : '—'}
            hint={
              summary.totalInvested > 0 ? 'Across all investment entries' : 'No investment data'
            }
            icon={DollarSign}
            tone="gold"
          />
        </dl>
      </section>

      {/* Ownership donut + stacked bar */}
      {breakdownEntries.length > 0 ? (
        <section aria-label="Ownership breakdown">
          <SectionTitle eyebrow="Breakdown" title="By Holder Type" />
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Donut */}
            <Card>
              <OwnershipDonut breakdown={breakdownEntries} />
            </Card>

            {/* Stacked bar breakdown */}
            <Card className="space-y-3">
              {breakdownEntries.map(([type, value], i) => (
                <BreakdownRow
                  key={type}
                  label={type}
                  value={value}
                  total={breakdownTotal}
                  color={DONUT_COLORS[i % DONUT_COLORS.length]}
                />
              ))}
            </Card>
          </div>
        </section>
      ) : null}

      {/* Holdings table */}
      <HoldingsTable entries={entries} />
    </div>
  );
}
