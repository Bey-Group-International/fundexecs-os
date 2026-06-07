'use client';

import { useState } from 'react';
import { ArrowUpRight, Target } from 'lucide-react';
import { Card, SectionTitle, AnimatedNumber } from '@/components/ui';
import { Drawer } from '@/components/drawers/Drawer';
import type { ReadinessDimensionScore } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';
import { RingGauge } from './RingGauge';
import { RadarChart, type RadarAxis } from './RadarChart';

type Dimension = ReadinessDimensionScore['dimension'];

const DIMENSION_LABEL: Record<Dimension, string> = {
  profile: 'Profile',
  proof: 'Proof',
  materials: 'Materials',
  pipeline: 'Pipeline',
  capital: 'Capital'
};

const DIMENSION_HINT: Record<Dimension, string> = {
  profile: 'Source of Truth completeness',
  proof: 'Chain-of-Trust depth',
  materials: 'Decks · memos · governance',
  pipeline: 'LP / deal universe depth',
  capital: 'Progress against target raise'
};

/** The specific next move that raises each dimension toward 100 (UI-side map). */
const DIMENSION_NEXT_ACTION: Record<Dimension, { action: string; cta: string; href: string }> = {
  profile: {
    action: 'Fill the remaining Profile fields a counterparty would probe.',
    cta: 'Open Profile',
    href: '/profile'
  },
  proof: {
    action: 'Advance your Chain of Trust — close the next proof layer with evidence.',
    cta: 'Open Trust Center',
    href: '/trust'
  },
  materials: {
    action: 'Complete your decks, memos, and governance docs.',
    cta: 'Open Materials',
    href: '/materials'
  },
  pipeline: {
    action: 'Add and contact more LP / deal targets to deepen coverage.',
    cta: 'Open Pipeline',
    href: '/pipeline'
  },
  capital: {
    action: 'Move warm interest to soft-circle and committed against your target.',
    cta: 'Open Capital Stack',
    href: '/capital-stack'
  }
};

function toneForScore(score: number): { color: string; bg: string; label: string } {
  if (score >= 75) return { color: 'var(--success)', bg: 'var(--success-soft)', label: 'Strong' };
  if (score >= 50) return { color: 'var(--accent)', bg: 'var(--accent-soft)', label: 'Solid' };
  if (score >= 25) return { color: 'var(--warning)', bg: 'var(--warning-soft)', label: 'Building' };
  return { color: 'var(--danger)', bg: 'var(--danger-soft)', label: 'Gap' };
}

export interface ReadinessGaugeProps {
  /** 0–100 institutional-readiness score. */
  score: number;
  /** Per-dimension breakdown (always the same 5 entries in display order). */
  breakdown: ReadinessDimensionScore[];
  className?: string;
}

/**
 * ReadinessGauge — the headline 0–100 institutional-readiness ring. Clicking
 * (or Enter/Space) opens the "Drive to 100%" detail view: a radar over the five
 * readiness dimensions, each dimension's gap to 100, and the specific next
 * action to raise it. The detail headline frames "N points to
 * institutional-ready" and calls out the weakest 1–2 dimensions as the focus.
 * Reuses the shared `Drawer` (focus trap + restore + ESC). Reduced-motion safe.
 */
export function ReadinessGauge({ score, breakdown, className }: ReadinessGaugeProps) {
  const [open, setOpen] = useState(false);
  const overall = toneForScore(score);
  const gap = Math.max(0, 100 - score);

  // Weakest 1–2 dimensions (lowest score first) = recommended focus.
  const ranked = [...breakdown].sort((a, b) => a.score - b.score);
  const focus = ranked.slice(0, 2);
  const focusLabels = focus.map((d) => DIMENSION_LABEL[d.dimension]);

  const axes: RadarAxis[] = breakdown.map((d) => ({
    label: DIMENSION_LABEL[d.dimension],
    value: d.score
  }));

  return (
    <Card className={cn('p-5', className)} data-testid="readiness-gauge">
      <SectionTitle
        eyebrow="Institutional readiness"
        title="How investable, today"
        className="mb-3"
      />

      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="readiness-gauge-open"
        aria-haspopup="dialog"
        aria-label={`Institutional readiness ${score} of 100 — ${gap} points to institutional-ready. Open Drive to 100% detail.`}
        className="group flex w-full items-center gap-4 rounded-xl border border-hairline bg-bg-1 p-3 text-left transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-azure-1"
      >
        <RingGauge
          value={score}
          size={104}
          stroke={9}
          color={overall.color}
          glow
          ariaLabel={`Readiness ${score} of 100`}
        >
          <AnimatedNumber value={score} className="text-[26px] font-semibold tracking-[-0.02em]" />
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            / 100
          </span>
        </RingGauge>

        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-fg-1">
            <span className="tabular-nums">{gap}</span> points to institutional-ready
          </p>
          <p className="mt-0.5 text-[11px] text-fg-3">
            {gap === 0
              ? 'You clear the institutional bar — keep it on the record.'
              : `Biggest lever${focusLabels.length > 1 ? 's' : ''}: ${focusLabels.join(' · ')}`}
          </p>
          <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-azure-1">
            Drive to 100%
            <ArrowUpRight
              size={12}
              strokeWidth={2}
              className="transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
        </div>
      </button>

      {/* Compact dimension list (always visible) */}
      <ul className="mt-3 grid gap-1.5" data-testid="readiness-gauge-breakdown">
        {breakdown.map((dim) => {
          const tone = toneForScore(dim.score);
          return (
            <li
              key={dim.dimension}
              data-testid={`readiness-dim-${dim.dimension}`}
              className="flex items-center gap-3 rounded-lg border border-hairline bg-bg-1 px-3 py-1.5"
            >
              <span className="w-20 flex-none text-[11.5px] font-semibold text-fg-2">
                {DIMENSION_LABEL[dim.dimension]}
              </span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${dim.score}%`, backgroundColor: tone.color }}
                />
              </span>
              <span
                className="w-8 flex-none text-right text-[11.5px] font-semibold tabular-nums"
                style={{ color: tone.color }}
              >
                {dim.score}
              </span>
            </li>
          );
        })}
      </ul>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Drive to 100%"
        subtitle={`${gap} points to institutional-ready`}
      >
        <ReadinessDetail score={score} gap={gap} breakdown={breakdown} focus={focus} axes={axes} />
      </Drawer>
    </Card>
  );
}

function ReadinessDetail({
  score,
  gap,
  breakdown,
  focus,
  axes
}: {
  score: number;
  gap: number;
  breakdown: ReadinessDimensionScore[];
  focus: ReadinessDimensionScore[];
  axes: RadarAxis[];
}) {
  const focusLabels = focus.map((d) => DIMENSION_LABEL[d.dimension]);
  return (
    <div className="flex flex-col gap-5">
      {/* Headline */}
      <div className="rounded-xl border border-[var(--azure-line)] bg-[var(--azure-soft)] p-4">
        <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-azure-1">
          <Target size={12} strokeWidth={2} aria-hidden />
          The compounding loop
        </p>
        <p className="mt-1 text-[15px] font-semibold tracking-[-0.01em] text-fg-1">
          {gap === 0 ? (
            "You're institutional-ready."
          ) : (
            <>
              <span className="tabular-nums">{gap}</span> points to institutional-ready
            </>
          )}
        </p>
        {gap > 0 ? (
          <p className="mt-1 text-[12px] text-fg-3">
            Your fastest path: focus on{' '}
            <span className="font-semibold text-fg-1">{focusLabels.join(' and ')}</span> — the
            weakest dimension{focusLabels.length > 1 ? 's' : ''} carrying the most untapped points.
          </p>
        ) : (
          <p className="mt-1 text-[12px] text-fg-3">
            Hold the line — keep every layer current so the score doesn&apos;t drift.
          </p>
        )}
      </div>

      {/* Radar */}
      <div className="flex flex-col items-center">
        <RadarChart
          axes={axes}
          ariaLabel={`Readiness radar. ${breakdown
            .map((d) => `${DIMENSION_LABEL[d.dimension]} ${d.score} of 100`)
            .join(', ')}. Overall ${score} of 100.`}
        />
      </div>

      {/* Per-dimension gap + next action */}
      <ol className="flex flex-col gap-2">
        {[...breakdown]
          .sort((a, b) => a.score - b.score)
          .map((dim) => {
            const tone = toneForScore(dim.score);
            const dimGap = Math.max(0, 100 - dim.score);
            const next = DIMENSION_NEXT_ACTION[dim.dimension];
            const isFocus = focus.some((f) => f.dimension === dim.dimension);
            return (
              <li
                key={dim.dimension}
                className={cn(
                  'rounded-xl border bg-bg-1 p-3',
                  isFocus ? 'border-[var(--azure-line)]' : 'border-hairline'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-fg-1">
                    {DIMENSION_LABEL[dim.dimension]}
                    {isFocus ? (
                      <span className="rounded-full bg-[var(--azure-soft)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-azure-1">
                        Focus
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="text-[12px] font-semibold tabular-nums"
                    style={{ color: tone.color }}
                  >
                    {dim.score}
                    <span className="text-fg-5"> / 100</span>
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-fg-4">{DIMENSION_HINT[dim.dimension]}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${dim.score}%`, backgroundColor: tone.color }}
                    />
                  </span>
                  <span className="text-[10px] font-semibold tabular-nums text-fg-4">
                    {dimGap} to go
                  </span>
                </div>
                {dimGap > 0 ? (
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <p className="text-[11.5px] text-fg-3">{next.action}</p>
                    <a
                      href={next.href}
                      className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-azure-1 hover:underline"
                    >
                      {next.cta}
                      <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                    </a>
                  </div>
                ) : (
                  <p className="mt-2 text-[11.5px] font-semibold text-success">
                    Maxed — nice work.
                  </p>
                )}
              </li>
            );
          })}
      </ol>
    </div>
  );
}

export default ReadinessGauge;
