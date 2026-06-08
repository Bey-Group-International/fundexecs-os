'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Layers,
  TrendingUp,
  Target,
  CircleDollarSign,
  Flag,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  type LucideIcon
} from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle, type BadgeTone } from '@/components/ui';
import { EmptyState } from '@/components/shell/EmptyState';
import { cn } from '@/lib/utils';
import { closeCommitment } from '@/lib/actions/capital';
import type { CapitalStackData, CapitalCommitment } from '@/lib/queries/capital-stack';

/* ---- Formatting helpers ------------------------------------------------- */
function money(n: number, currency = 'USD'): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(n);
}

function pct(n: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((n / total) * 100));
}

function stageTone(stage: string): BadgeTone {
  const s = stage.toLowerCase();
  if (s.includes('closed') || s.includes('funded')) return 'success';
  if (s.includes('committed')) return 'azure';
  if (s.includes('soft') || s.includes('interested')) return 'warning';
  if (s.includes('withdrawn') || s.includes('dead')) return 'danger';
  return 'neutral';
}

function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---- Sub-components ----------------------------------------------------- */

const TONE_TEXT: Record<BadgeTone, string> = {
  neutral: 'text-fg-4',
  gold: 'text-gold-1',
  azure: 'text-azure-1',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info'
};

const TONE_VAR: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};

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
      {/* Tone accent rail — adds depth without flooding the surface. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: TONE_VAR[tone] }}
      />
      <div className="flex items-center justify-between">
        <dt className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          {label}
        </dt>
        <span className={TONE_TEXT[tone]}>
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

function BreakdownRow({
  label,
  amount,
  total,
  tone
}: {
  label: string;
  amount: number;
  total: number;
  tone: BadgeTone;
}) {
  const p = pct(amount, total);
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 flex-none truncate text-[12.5px] text-fg-2">{label}</div>
      <ProgressBar
        value={p}
        height={5}
        color={TONE_VAR[tone]}
        ariaLabel={`${label} allocation`}
        className="flex-1"
      />
      <div className="w-20 flex-none text-right text-[12.5px] tabular-nums text-fg-2">
        {money(amount)}
      </div>
      <div className="w-10 flex-none text-right text-[11px] tabular-nums text-fg-4">{p}%</div>
    </div>
  );
}

/* ---- LP-type donut ------------------------------------------------------ */

/** A rotating palette for donut/legend segments (tokens only). */
const DONUT_COLORS = [
  'var(--azure-1)',
  'var(--success)',
  'var(--gold-1)',
  'var(--info)',
  'var(--warning)',
  'var(--fg-4)'
];

function LpTypeDonut({
  entries,
  currency
}: {
  entries: Array<[string, number]>;
  currency: string;
}) {
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  const radius = 52;
  const stroke = 18;
  const circumference = 2 * Math.PI * radius;

  // Build cumulative segments for the SVG ring. Each segment's rotation is the
  // running sum of all prior amounts — computed without mutating outer state so
  // the render stays pure (React Compiler-safe).
  const segments = entries.map(([label, amount], i) => {
    const fraction = total > 0 ? amount / total : 0;
    const priorSum = entries.slice(0, i).reduce((sum, [, v]) => sum + v, 0);
    return {
      label,
      amount,
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
          aria-label="LP type allocation donut"
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
            Total
          </span>
          <span className="text-[15px] font-semibold tabular-nums text-fg-1">
            {money(total, currency)}
          </span>
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
            <span className="min-w-0 flex-1 truncate text-fg-2">{stageLabel(seg.label)}</span>
            <span className="flex-none tabular-nums text-fg-2">{money(seg.amount, currency)}</span>
            <span className="w-10 flex-none text-right tabular-nums text-fg-4">
              {pct(seg.amount, total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A commitment can still be closed unless it's already closed/funded/withdrawn. */
function isCloseable(stage: string): boolean {
  const s = stage.toLowerCase();
  return !s.includes('closed') && !s.includes('funded') && !s.includes('withdrawn');
}

function CommitmentsTable({ commitments }: { commitments: CapitalCommitment[] }) {
  const [expanded, setExpanded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isClosing, startClose] = useTransition();
  const router = useRouter();
  const visible = expanded ? commitments : commitments.slice(0, 8);

  if (commitments.length === 0) return null;

  const onClose = (id: string) => {
    setPendingId(id);
    startClose(async () => {
      // Closing a commitment closes the loop — proof of work flows back into the
      // record (see lib/actions/capital.ts). Refresh to pick up the new state.
      await closeCommitment(id);
      router.refresh();
      setPendingId(null);
    });
  };

  return (
    <div>
      <SectionTitle
        eyebrow="Capital Formation"
        title="Commitments"
        action={
          <Badge tone="neutral" className="text-[10.5px]">
            {commitments.length} {commitments.length === 1 ? 'entry' : 'entries'}
          </Badge>
        }
      />
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-hairline bg-surface-1">
                <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-[0.09em] text-fg-4">
                  Stage
                </th>
                <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-[0.09em] text-fg-4">
                  LP Type
                </th>
                <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-[0.09em] text-fg-4">
                  Amount
                </th>
                <th className="hidden px-4 py-2.5 text-left font-semibold uppercase tracking-[0.09em] text-fg-4 sm:table-cell">
                  Tranche
                </th>
                <th className="hidden px-4 py-2.5 text-left font-semibold uppercase tracking-[0.09em] text-fg-4 md:table-cell">
                  Expected Close
                </th>
                <th className="px-4 py-2.5 text-right font-semibold uppercase tracking-[0.09em] text-fg-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c, i) => (
                <tr
                  key={c.id}
                  className={cn(
                    'border-b border-hairline last:border-0',
                    i % 2 === 0 ? 'bg-transparent' : 'bg-surface-1/40'
                  )}
                >
                  <td className="px-4 py-2.5">
                    <Badge tone={stageTone(c.stage)} className="text-[10.5px]">
                      {stageLabel(c.stage)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-fg-3">
                    {c.lpType ? stageLabel(c.lpType) : <span className="text-fg-5">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-fg-1">
                    {money(c.amount, c.currency)}
                  </td>
                  <td className="hidden px-4 py-2.5 text-fg-3 sm:table-cell">
                    {c.tranche ?? <span className="text-fg-5">—</span>}
                  </td>
                  <td className="hidden px-4 py-2.5 text-fg-3 md:table-cell">
                    {c.expectedClose ? (
                      new Date(c.expectedClose).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })
                    ) : (
                      <span className="text-fg-5">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {isCloseable(c.stage) ? (
                      <button
                        type="button"
                        onClick={() => onClose(c.id)}
                        disabled={isClosing && pendingId === c.id}
                        data-testid={`capital-close-${c.id}`}
                        className="inline-flex items-center gap-1 rounded-[8px] border border-hairline px-2 py-1 text-[11px] font-medium text-fg-3 transition hover:border-[var(--azure-line)] hover:bg-[var(--azure-soft)] hover:text-azure-1 disabled:opacity-50"
                      >
                        <CheckCircle2 size={12} strokeWidth={2} aria-hidden />
                        {isClosing && pendingId === c.id ? 'Closing…' : 'Mark closed'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {commitments.length > 8 ? (
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
                Show all {commitments.length} commitments
              </>
            )}
          </button>
        ) : null}
      </Card>
    </div>
  );
}

/* ---- Main view ---------------------------------------------------------- */

export interface CapitalStackViewProps {
  data: CapitalStackData;
}

export function CapitalStackView({ data }: CapitalStackViewProps) {
  const { summary, commitments, empty } = data;

  if (empty) {
    return (
      <EmptyState
        icon={Layers}
        title="No capital stack data yet"
        body="Once your organization has capital commitments or allocations, the full raise structure will appear here — broken out by stage, LP type, and gap-to-target."
      />
    );
  }

  const s = summary;
  const totalRaised = s ? s.committedTotal + s.softCircleTotal : 0;
  const targetTotal = s?.targetTotal ?? 0;
  const gapToTarget = s?.gapToTarget ?? 0;
  const coveragePct = pct(totalRaised, targetTotal);
  const committedPct = pct(s?.committedTotal ?? 0, targetTotal);

  // Derived breakdowns (React Compiler memoizes) — sorted desc, with each
  // breakdown's own sum as the percentage denominator.
  const stageEntries = s
    ? Object.entries(s.stageTotals)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
    : [];
  const stageSum = stageEntries.reduce((sum, [, v]) => sum + v, 0);
  const lpTypeEntries = s
    ? Object.entries(s.lpTypeTotals)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
    : [];

  return (
    <div className="space-y-8">
      {/* KPI tiles */}
      {s ? (
        <section aria-label="Capital stack summary">
          <SectionTitle eyebrow="Capital Formation" title="Raise Overview" />
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Target"
              value={money(targetTotal, s.currency)}
              hint="Fund raise target"
              icon={Target}
              tone="neutral"
            />
            <KpiTile
              label="Committed"
              value={money(s.committedTotal, s.currency)}
              hint={`${committedPct}% of target`}
              icon={CircleDollarSign}
              tone="success"
            />
            <KpiTile
              label="Soft-circled"
              value={money(s.softCircleTotal, s.currency)}
              hint="Indicative interest"
              icon={TrendingUp}
              tone="azure"
            />
            <KpiTile
              label="Gap to target"
              value={money(Math.max(0, gapToTarget), s.currency)}
              hint={gapToTarget <= 0 ? 'Target reached' : 'Still to close'}
              icon={Flag}
              tone={gapToTarget <= 0 ? 'success' : 'warning'}
            />
          </dl>

          {/* Raise progress bar */}
          <Card className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-fg-3">Raise progress</span>
              <span className="text-[12.5px] tabular-nums text-fg-2">
                {money(totalRaised, s.currency)} /{' '}
                <span className="text-fg-4">{money(targetTotal, s.currency)}</span>
              </span>
            </div>
            <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
              {/* Committed layer */}
              <div
                className="absolute inset-y-0 left-0 rounded-l-full bg-success transition-[width]"
                style={{ width: `${committedPct}%` }}
                aria-hidden
              />
              {/* Soft-circle layer */}
              <div
                className="absolute inset-y-0 rounded-r-full bg-azure-1 opacity-60 transition-[width]"
                style={{
                  left: `${committedPct}%`,
                  width: `${Math.max(0, coveragePct - committedPct)}%`
                }}
                aria-hidden
              />
            </div>
            <div className="mt-2 flex items-center gap-4 text-[11px] text-fg-4">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                Committed {committedPct}%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-azure-1 opacity-60" aria-hidden />
                Soft-circled {Math.max(0, coveragePct - committedPct)}%
              </span>
              <span className="ml-auto">{coveragePct}% covered</span>
            </div>
          </Card>
        </section>
      ) : null}

      {/* Stage breakdown — percentages are relative to the stage total so the
          rows sum to 100%, not to committed+soft-circled. */}
      {s && stageEntries.length > 0 ? (
        <section aria-label="Stage breakdown">
          <SectionTitle eyebrow="Breakdown" title="By Stage" />
          <Card className="space-y-3">
            {stageEntries.map(([stage, amount]) => (
              <BreakdownRow
                key={stage}
                label={stageLabel(stage)}
                amount={amount}
                total={stageSum || 1}
                tone={stageTone(stage)}
              />
            ))}
          </Card>
        </section>
      ) : null}

      {/* LP type breakdown — donut + legend. */}
      {s && lpTypeEntries.length > 0 ? (
        <section aria-label="LP type breakdown">
          <SectionTitle eyebrow="Breakdown" title="By LP Type" />
          <Card>
            <LpTypeDonut entries={lpTypeEntries} currency={s.currency} />
          </Card>
        </section>
      ) : null}

      {/* Commitments table */}
      <CommitmentsTable commitments={commitments} />

      {/* Withdrawn / closed note */}
      {s && (s.withdrawnTotal > 0 || s.closedTotal > 0) ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--warning-line)] bg-[var(--warning-soft)] px-4 py-3">
          <AlertCircle
            size={15}
            strokeWidth={1.9}
            className="mt-0.5 flex-none text-warning"
            aria-hidden
          />
          <p className="text-[12.5px] text-fg-2">
            {s.closedTotal > 0 && (
              <>
                <strong>{money(s.closedTotal, s.currency)}</strong> fully closed.{' '}
              </>
            )}
            {s.withdrawnTotal > 0 && (
              <>
                <strong>{money(s.withdrawnTotal, s.currency)}</strong> withdrawn.
              </>
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
