'use client';

import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  RotateCcw,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Minus,
  Zap
} from 'lucide-react';
import { Card, SectionTitle, AnimatedNumber } from '@/components/ui';
import { RingGauge } from '@/components/dashboard/RingGauge';
import { RadarChart, type RadarAxis } from '@/components/dashboard/RadarChart';
import { Sparkline } from '@/components/dashboard/Sparkline';
import { compactMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReadinessDimension, ReadinessDimensionScore } from '@/lib/lifecycle';
import {
  computeCompoundReadiness,
  computeReadinessValue,
  rankByValue,
  type CompoundReadiness,
  type ReadinessValue,
  type RankedDimension
} from '@/lib/readiness';
import type { ReadinessHistory } from '@/lib/queries/dashboard/readiness-history';

type Dimension = ReadinessDimension;

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

function toneForScore(score: number): { color: string; label: string } {
  if (score >= 75) return { color: 'var(--success)', label: 'Strong' };
  if (score >= 50) return { color: 'var(--accent)', label: 'Solid' };
  if (score >= 25) return { color: 'var(--warning)', label: 'Building' };
  return { color: 'var(--danger)', label: 'Gap' };
}

export interface ReadinessViewProps {
  breakdown: ReadinessDimensionScore[];
  compound: CompoundReadiness;
  value: ReadinessValue;
  ranked: RankedDimension[];
  history: ReadinessHistory;
  target: number;
  lockedByReadiness: number;
}

/**
 * ReadinessView — the interactive compound-readiness surface. Server hands in
 * the live model; the what-if sliders recompute the compound score, projected
 * value, and action ranking entirely client-side via the same pure engine, so
 * "what happens if I close Proof?" answers instantly without a round-trip.
 */
export function ReadinessView({
  breakdown,
  compound,
  value,
  ranked,
  history,
  target,
  lockedByReadiness
}: ReadinessViewProps) {
  // What-if state: a per-dimension score override. Starts at the live scores.
  const liveScores = useMemo(
    () =>
      Object.fromEntries(breakdown.map((d) => [d.dimension, d.score])) as Record<Dimension, number>,
    [breakdown]
  );
  const [draft, setDraft] = useState<Record<Dimension, number>>(liveScores);

  const dirty = useMemo(
    () => breakdown.some((d) => draft[d.dimension] !== d.score),
    [draft, breakdown]
  );

  // Recompute the entire model from the draft scores. Pure + cheap.
  const sim = useMemo(() => {
    const simBreakdown: ReadinessDimensionScore[] = breakdown.map((d) => ({
      ...d,
      score: draft[d.dimension],
      contribution: (draft[d.dimension] * d.weight) / 100
    }));
    const c = computeCompoundReadiness(simBreakdown);
    const v = computeReadinessValue(c, target);
    return { compound: c, value: v, ranked: rankByValue(c, v) };
  }, [draft, breakdown, target]);

  // When the sliders are untouched, show the server model verbatim; otherwise
  // show the simulated one. Keeps the "live" view authoritative.
  const view = dirty
    ? sim
    : { compound, value, ranked };

  const overall = toneForScore(view.compound.compoundScore);
  const gap = Math.max(0, 100 - view.compound.compoundScore);
  const premium = view.compound.compoundScore - view.compound.baseScore;

  const axes: RadarAxis[] = breakdown.map((d) => ({
    label: DIMENSION_LABEL[d.dimension],
    value: draft[d.dimension]
  }));

  const trendPoints = history.series.map((p) => p.score);
  const mom = history.momentum;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Hero: compound score + multiplier + projected value + trend ── */}
      <Card className="@container p-5">
        <SectionTitle
          eyebrow="Compound Readiness"
          title="How investable, compounded"
          className="mb-4"
        />
        <div className="flex flex-col gap-5 @[44rem]:flex-row @[44rem]:items-center">
          <div className="flex flex-none items-center gap-4">
            <RingGauge
              value={view.compound.compoundScore}
              size={132}
              stroke={11}
              color={overall.color}
              glow
              ariaLabel={`Compound readiness ${view.compound.compoundScore} of 100`}
            >
              <AnimatedNumber
                value={view.compound.compoundScore}
                className="text-[34px] font-semibold tracking-[-0.02em]"
              />
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                / 100
              </span>
            </RingGauge>
            <div className="min-w-0">
              <MultiplierBadge multiplier={view.compound.multiplier} />
              <p className="mt-2 text-[12px] text-fg-3">
                Base{' '}
                <span className="font-semibold tabular-nums text-fg-1">
                  {view.compound.baseScore}
                </span>{' '}
                {premium >= 0 ? '+' : '−'}
                <span className="font-semibold tabular-nums text-fg-1">
                  {Math.abs(premium)}
                </span>{' '}
                from compounding
              </p>
              <p className="mt-0.5 text-[11px] text-fg-4">
                {gap === 0
                  ? 'You clear the institutional bar.'
                  : `${gap} points to institutional-ready`}
              </p>
            </div>
          </div>

          <div className="grid flex-1 gap-3 @[30rem]:grid-cols-2">
            <ValueTile
              label="Projected closeable"
              amount={view.value.projected}
              hint={target > 0 ? `at ${view.compound.compoundScore}% readiness` : 'set a target raise'}
              tone="success"
            />
            <ValueTile
              label="Locked by readiness"
              amount={dirty ? view.value.locked : lockedByReadiness}
              hint="unlocks as the score climbs"
              tone="warning"
            />
          </div>
        </div>

        {/* Trend + momentum */}
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-hairline bg-bg-1 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
              Trend · 30 days
            </p>
            <MomentumLine
              delta={mom.delta}
              velocity={mom.velocity}
              direction={mom.direction}
              samples={mom.samples}
            />
          </div>
          {trendPoints.length >= 2 ? (
            <Sparkline
              points={trendPoints}
              tone={mom.direction === 'down' ? 'danger' : 'success'}
              width={160}
              height={40}
              ariaLabel={`Readiness trend over ${mom.samples} snapshots`}
            />
          ) : (
            <p className="text-[11px] text-fg-4">Trend builds as you return — check back tomorrow.</p>
          )}
        </div>
      </Card>

      <div className="grid gap-5 @container lg:grid-cols-[1.15fr_1fr]">
        {/* ── What-if simulator ── */}
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle
              eyebrow="What if"
              title={
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal size={15} strokeWidth={2} aria-hidden />
                  Drag to see the compounding
                </span>
              }
            />
            {dirty ? (
              <button
                type="button"
                onClick={() => setDraft(liveScores)}
                className="inline-flex items-center gap-1 rounded-lg border border-hairline px-2.5 py-1 text-[11px] font-semibold text-fg-2 transition-colors hover:bg-surface-2"
              >
                <RotateCcw size={12} strokeWidth={2} aria-hidden />
                Reset
              </button>
            ) : null}
          </div>

          <ul className="flex flex-col gap-3">
            {breakdown.map((d) => {
              const dim = d.dimension;
              const tone = toneForScore(draft[dim]);
              const delta = draft[dim] - d.score;
              const isFoundation = view.compound.dimensions.find(
                (x) => x.dimension === dim
              )?.kind === 'foundation';
              return (
                <li key={dim}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[12.5px] font-semibold text-fg-1">
                      {DIMENSION_LABEL[dim]}
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]',
                          isFoundation
                            ? 'bg-[var(--azure-soft)] text-azure-1'
                            : 'bg-surface-2 text-fg-3'
                        )}
                      >
                        {isFoundation ? 'Foundation' : 'Execution'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-[11.5px] font-semibold tabular-nums">
                      {delta !== 0 ? (
                        <span className={delta > 0 ? 'text-success' : 'text-danger'}>
                          {delta > 0 ? '+' : ''}
                          {delta}
                        </span>
                      ) : null}
                      <span style={{ color: tone.color }}>{draft[dim]}</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draft[dim]}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [dim]: Number(e.target.value) }))
                    }
                    aria-label={`${DIMENSION_LABEL[dim]} score`}
                    className="w-full cursor-pointer"
                    style={{ accentColor: tone.color }}
                  />
                </li>
              );
            })}
          </ul>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-hairline bg-bg-1 p-3 text-center">
            <SimStat label="Compound" value={view.compound.compoundScore} suffix="/100" />
            <SimStat
              label="Synergy"
              value={Math.round(view.compound.synergy * 100)}
              suffix="%"
            />
            <SimStat
              label="Balance bonus"
              value={Math.round(view.compound.balanceBonus)}
              suffix="pts"
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-4">
            Foundation (Profile · Proof) sets <span className="font-semibold text-fg-2">synergy</span>{' '}
            — execution counts for more once you&apos;re credible. Clear every link past{' '}
            {/* balance floor */}40 and the loop earns a{' '}
            <span className="font-semibold text-fg-2">balance bonus</span>.
          </p>
        </Card>

        {/* ── Radar ── */}
        <Card className="flex flex-col items-center p-5">
          <SectionTitle
            eyebrow="Shape"
            title="Balance across the five"
            className="mb-2 self-start"
          />
          <RadarChart
            axes={axes}
            ariaLabel={`Readiness radar. ${breakdown
              .map((d) => `${DIMENSION_LABEL[d.dimension]} ${draft[d.dimension]} of 100`)
              .join(', ')}.`}
          />
          <p className="mt-2 text-center text-[11px] text-fg-4">
            A round shape compounds; a spiky one leaks value through its weakest link
            {' '}
            <span className="font-semibold text-fg-2">
              ({DIMENSION_LABEL[view.compound.weakestLink]})
            </span>
            .
          </p>
        </Card>
      </div>

      {/* ── Ranked actions: fastest value, not biggest gap ── */}
      <Card className="p-5">
        <SectionTitle
          eyebrow="Drive to 100%"
          title={
            <span className="inline-flex items-center gap-2">
              <Zap size={15} strokeWidth={2} aria-hidden />
              Ranked by value unlocked
            </span>
          }
          className="mb-3"
        />
        <ol className="flex flex-col gap-2">
          {view.ranked.map((r, i) => {
            const tone = toneForScore(r.score);
            const next = DIMENSION_NEXT_ACTION[r.dimension];
            const maxed = r.gap === 0;
            return (
              <li
                key={r.dimension}
                className={cn(
                  'rounded-xl border bg-bg-1 p-3',
                  i === 0 && !maxed ? 'border-[var(--azure-line)]' : 'border-hairline'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-fg-1">
                    <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-surface-2 text-[10px] tabular-nums text-fg-3">
                      {i + 1}
                    </span>
                    {DIMENSION_LABEL[r.dimension]}
                    {i === 0 && !maxed ? (
                      <span className="rounded-full bg-[var(--azure-soft)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-azure-1">
                        Best lever
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="text-[12px] font-semibold tabular-nums"
                    style={{ color: tone.color }}
                  >
                    {r.score}
                    <span className="text-fg-5"> / 100</span>
                  </span>
                </div>
                <p className="mt-0.5 pl-7 text-[11px] text-fg-4">
                  {DIMENSION_HINT[r.dimension]}
                </p>

                {maxed ? (
                  <p className="mt-2 pl-7 text-[11.5px] font-semibold text-success">
                    Maxed — nice work.
                  </p>
                ) : (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-[11px]">
                      <Stat label="+points" value={`${r.lift.toFixed(1)}`} />
                      {target > 0 ? (
                        <>
                          <Stat label="unlocks" value={compactMoney(r.valueUnlock)} accent />
                          <Stat
                            label="per point"
                            value={compactMoney(Math.round(r.valuePerPoint))}
                          />
                        </>
                      ) : (
                        <Stat label="gap" value={`${r.gap} pts`} />
                      )}
                    </div>
                    <div className="mt-2 flex items-start justify-between gap-3 pl-7">
                      <p className="text-[11.5px] text-fg-3">{next.action}</p>
                      <a
                        href={next.href}
                        className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-azure-1 hover:underline"
                      >
                        {next.cta}
                        <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                      </a>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

/* ── small presentational helpers ─────────────────────────────────────── */

function MultiplierBadge({ multiplier }: { multiplier: number }) {
  const reinforcing = multiplier >= 1;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums',
        reinforcing
          ? 'bg-[var(--success-soft)] text-success'
          : 'bg-[var(--warning-soft)] text-warning'
      )}
    >
      {reinforcing ? (
        <TrendingUp size={13} strokeWidth={2.2} aria-hidden />
      ) : (
        <TrendingDown size={13} strokeWidth={2.2} aria-hidden />
      )}
      {multiplier.toFixed(2)}× {reinforcing ? 'reinforcing' : 'drag'}
    </span>
  );
}

function ValueTile({
  label,
  amount,
  hint,
  tone
}: {
  label: string;
  amount: number;
  hint: string;
  tone: 'success' | 'warning';
}) {
  return (
    <div className="rounded-xl border border-hairline bg-bg-1 p-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">{label}</p>
      <p
        className="mt-1 text-[22px] font-semibold tracking-[-0.02em] tabular-nums"
        style={{ color: tone === 'success' ? 'var(--success)' : 'var(--warning)' }}
      >
        {amount > 0 ? compactMoney(amount) : '—'}
      </p>
      <p className="mt-0.5 text-[11px] text-fg-4">{hint}</p>
    </div>
  );
}

function MomentumLine({
  delta,
  velocity,
  direction,
  samples
}: {
  delta: number;
  velocity: number;
  direction: 'up' | 'down' | 'flat';
  samples: number;
}) {
  if (samples < 2) {
    return <p className="mt-0.5 text-[12.5px] font-semibold text-fg-2">First snapshot recorded</p>;
  }
  const color =
    direction === 'up' ? 'text-success' : direction === 'down' ? 'text-danger' : 'text-fg-3';
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  return (
    <p className={cn('mt-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold', color)}>
      <Icon size={14} strokeWidth={2.2} aria-hidden />
      {delta > 0 ? '+' : ''}
      {delta} pts
      <span className="text-[11px] font-medium text-fg-4">
        · {velocity > 0 ? '+' : ''}
        {velocity}/day
      </span>
    </p>
  );
}

function SimStat({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div>
      <p className="text-[18px] font-semibold tabular-nums text-fg-1">
        {value}
        <span className="text-[11px] font-medium text-fg-4">{suffix}</span>
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-4">{label}</p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className={cn(
          'font-semibold tabular-nums',
          accent ? 'text-success' : 'text-fg-1'
        )}
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-[0.08em] text-fg-4">{label}</span>
    </span>
  );
}

export default ReadinessView;
