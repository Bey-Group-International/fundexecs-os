import Link from 'next/link';
import {
  Gauge,
  CircleDollarSign,
  ClipboardCheck,
  CalendarClock,
  type LucideIcon
} from 'lucide-react';
import { Card } from '@/components/ui';
import type { CommandMetrics as Metrics } from '@/lib/queries/dashboard/command-metrics';

/* ============================================================================
 * CommandMetrics — the four side-by-side boxes: Readiness (brief + score) and
 * three live counts (active commitments · deals under review · tasks due this
 * week). Each non-readiness box deep-links to the surface that resolves it;
 * "Daily command" expands the same three counts.
 * ========================================================================= */

function readinessLabel(score: number): { label: string; color: string } {
  if (score >= 75) return { label: 'Strong', color: 'var(--success)' };
  if (score >= 50) return { label: 'Solid', color: 'var(--accent)' };
  if (score >= 25) return { label: 'Building', color: 'var(--warning)' };
  return { label: 'Gap', color: 'var(--danger)' };
}

function Box({
  icon: Icon,
  eyebrow,
  value,
  detail,
  accent,
  href
}: {
  icon: LucideIcon;
  eyebrow: string;
  value: string;
  detail: string;
  accent: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block overflow-hidden rounded-2xl border border-hairline bg-bg-1 p-4 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-azure-1"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 break-words text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-fg-4">
          {eyebrow}
        </span>
        <span
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border"
          style={{
            color: accent,
            background: `color-mix(in srgb, ${accent} 12%, transparent)`,
            borderColor: `color-mix(in srgb, ${accent} 30%, transparent)`
          }}
        >
          <Icon size={14} strokeWidth={2} aria-hidden />
        </span>
      </div>
      <div
        className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] text-fg-1 tabular-nums"
        style={{ color: accent }}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-tight text-fg-4">{detail}</div>
    </Link>
  );
}

export function CommandMetrics({
  metrics,
  readinessScore,
  topGap
}: {
  metrics: Metrics;
  readinessScore: number;
  /** Highest-impact readiness gap label, if any. */
  topGap?: string;
}) {
  const tone = readinessLabel(readinessScore);
  const gap = Math.max(0, 100 - readinessScore);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Box
        icon={Gauge}
        eyebrow="Readiness"
        value={`${readinessScore}`}
        detail={gap === 0 ? 'Institutional-ready' : `${gap} pts to ready · ${tone.label}`}
        accent={tone.color}
        href="/trust"
      />
      <Box
        icon={CircleDollarSign}
        eyebrow="Active commitments"
        value={`${metrics.activeCommitments}`}
        detail={topGap ? `In the pipeline · ${topGap}` : 'Live in the pipeline'}
        accent="var(--gold-1)"
        href="/capital-stack"
      />
      <Box
        icon={ClipboardCheck}
        eyebrow="Deals under review"
        value={`${metrics.underReview}`}
        detail="In diligence now"
        accent="var(--azure-1)"
        href="/diligence"
      />
      <Box
        icon={CalendarClock}
        eyebrow="Tasks due this week"
        value={`${metrics.tasksDueThisWeek}`}
        detail="Open · next 7 days"
        accent="var(--accent)"
        href="/action-queue"
      />
    </div>
  );
}

export default CommandMetrics;
