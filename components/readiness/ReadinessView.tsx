'use client';

import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  Minus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  TrendingUp
} from 'lucide-react';
import { Card, SectionTitle, AnimatedNumber } from '@/components/ui';
import { RingGauge } from '@/components/dashboard/RingGauge';
import { RadarChart, type RadarAxis } from '@/components/dashboard/RadarChart';
import { compactMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReadinessDimension, ReadinessDimensionScore } from '@/lib/lifecycle';
import {
  INSTITUTIONAL_BAR,
  computeCompoundReadiness,
  computeReadinessValue,
  rankByValue,
  type CompoundReadiness,
  type ReadinessTrajectory,
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

/** Map a 0–100 score to a semantic color + band label (Strong/Solid/Building/Gap). */
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
  trajectory: ReadinessTrajectory;
  target: number;
  lockedByReadiness: number;
}

/**
 * ReadinessView — the compound-readiness surface, refined to lead with the one
 * move that matters. The first screen answers "where do I stand, and what do I
 * do next?": the compound score against the institutional bar, the single
 * highest-value action as a one-click CTA, a since-last-week digest, and the
 * forward trajectory of steady execution. The what-if simulator and radar — the
 * exploratory depth — live behind a disclosure so they never crowd the decision.
 */
export function ReadinessView({
  breakdown,
  compound,
  value,
  ranked,
  history,
  trajectory,
  target,
  lockedByReadiness
}: ReadinessViewProps) {
  const gapToBar = Math.max(0, INSTITUTIONAL_BAR - compound.compoundScore);
  const atBar = compound.compoundScore >= INSTITUTIONAL_BAR;
  const premium = compound.compoundScore - compound.baseScore;
  const overall = toneForScore(compound.compoundScore);

  // The single highest-value move (skip any already maxed).
  const topMove = ranked.find((r) => r.gap > 0) ?? null;

  const pastScores = history.series.map((p) => p.score);
  const digest = history.digest;
  const weekValueDelta = target > 0 ? Math.round((target * digest.weekDelta) / 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Hero: where you stand + your #1 move ──────────────────────────── */}
      <Card className="@container p-5">
        <SectionTitle eyebrow="Compound Readiness" title="Where you stand" className="mb-4" />
        <div className="flex flex-col gap-5 @[46rem]:flex-row @[46rem]:items-stretch">
          {/* Standing */}
          <div className="flex flex-none items-center gap-4">
            <RingGauge
              value={compound.compoundScore}
              size={132}
              stroke={11}
              color={overall.color}
              glow
              ariaLabel={`Compound readiness ${compound.compoundScore} of 100`}
            >
              <AnimatedNumber
                value={compound.compoundScore}
                className="text-[34px] font-semibold tracking-[-0.02em]"
              />
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                / 100
              </span>
            </RingGauge>
            <div className="min-w-0">
              <MultiplierBadge multiplier={compound.multiplier} />
              <p className="mt-2 text-[12px] text-fg-3">
                Base{' '}
                <span className="font-semibold tabular-nums text-fg-1">{compound.baseScore}</span>{' '}
                {premium >= 0 ? '+' : '−'}
                <span className="font-semibold tabular-nums text-fg-1">
                  {Math.abs(premium)}
                </span>{' '}
                from compounding
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-4">
                <span
                  className="inline-block h-1.5 w-1.5 flex-none rounded-full"
                  style={{ backgroundColor: atBar ? 'var(--success)' : 'var(--warning)' }}
                  aria-hidden
                />
                {atBar ? (
                  <>Clears the institutional bar ({INSTITUTIONAL_BAR})</>
                ) : (
                  <>
                    <span className="font-semibold tabular-nums text-fg-2">{gapToBar}</span> to the
                    institutional bar ({INSTITUTIONAL_BAR})
                  </>
                )}
              </p>
            </div>
          </div>

          {/* #1 move — the focal point */}
          <div className="flex-1 @[46rem]:border-l @[46rem]:border-hairline @[46rem]:pl-5">
            {topMove ? (
              <NextMove move={topMove} target={target} />
            ) : (
              <div className="flex h-full flex-col justify-center rounded-xl border border-[var(--success-line)] bg-[var(--success-soft)] p-4">
                <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-success">
                  <Sparkles size={12} strokeWidth={2} aria-hidden />
                  Institutional-ready
                </p>
                <p className="mt-1 text-[14px] font-semibold text-fg-1">
                  Every dimension is maxed. Hold the line.
                </p>
                <p className="mt-1 text-[12px] text-fg-3">
                  Keep each layer current so the score doesn&apos;t drift below the bar.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Value at stake — compact, always honest about the target */}
        <div className="mt-4 grid gap-3 @[30rem]:grid-cols-2">
          <ValueTile
            label="Projected closeable"
            amount={value.projected}
            hint={target > 0 ? `at ${compound.compoundScore}% readiness` : 'set a target raise'}
            tone="success"
          />
          <ValueTile
            label="Locked by readiness"
            amount={lockedByReadiness}
            hint="unlocks as the score climbs"
            tone="warning"
          />
        </div>
      </Card>

      {/* ── Momentum + trajectory ─────────────────────────────────────────── */}
      <Card className="p-5">
        <SectionTitle
          eyebrow="Compounding"
          title="Where steady execution lands you"
          className="mb-3"
        />
        <DigestStrip digest={digest} weekValueDelta={weekValueDelta} hasTarget={target > 0} />
        <div className="mt-4">
          <TrajectoryChart past={pastScores} trajectory={trajectory} />
          <TrajectoryCaption trajectory={trajectory} target={target} />
        </div>
      </Card>

      {/* ── Other moves, ranked by value ──────────────────────────────────── */}
      {ranked.some((r) => r.gap > 0 && r !== topMove) ? (
        <Card className="p-5">
          <SectionTitle eyebrow="Then" title="Next moves, by value unlocked" className="mb-3" />
          <ol className="flex flex-col gap-2">
            {ranked
              .filter((r) => r !== topMove)
              .map((r, i) => (
                <MoveRow key={r.dimension} move={r} rank={i + 2} target={target} />
              ))}
          </ol>
        </Card>
      ) : null}

      {/* ── Explore the model (progressive disclosure) ────────────────────── */}
      <ExploreModel breakdown={breakdown} target={target} />
    </div>
  );
}

/* ── #1 move ───────────────────────────────────────────────────────────── */

/** The hero call-to-action: the single highest-value dimension to move next. */
function NextMove({ move, target }: { move: RankedDimension; target: number }) {
  const next = DIMENSION_NEXT_ACTION[move.dimension];
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-azure-1">
        <Sparkles size={12} strokeWidth={2} aria-hidden />
        Your #1 move
      </p>
      <p className="mt-1 text-[16px] font-semibold tracking-[-0.01em] text-fg-1">
        {DIMENSION_LABEL[move.dimension]}
        <span className="text-fg-4"> · {DIMENSION_HINT[move.dimension]}</span>
      </p>
      <p className="mt-1 text-[12.5px] text-fg-3">{next.action}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
        <Stat label="readiness" value={`+${move.lift.toFixed(1)} pts`} />
        {target > 0 ? <Stat label="unlocks" value={compactMoney(move.valueUnlock)} accent /> : null}
      </div>
      <a
        href={next.href}
        className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg bg-azure-1 px-3.5 py-2 text-[12.5px] font-semibold text-[#070b14] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-azure-1"
      >
        {next.cta}
        <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden />
      </a>
    </div>
  );
}

/* ── Digest ────────────────────────────────────────────────────────────── */

/** "Since last week" read — score Δ, derived $ Δ, and the tracking streak. */
function DigestStrip({
  digest,
  weekValueDelta,
  hasTarget
}: {
  digest: ReadinessHistory['digest'];
  weekValueDelta: number;
  hasTarget: boolean;
}) {
  if (!digest.hasPrior) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-hairline bg-bg-1 px-4 py-3 text-[12px] text-fg-3">
        <Minus size={14} strokeWidth={2} className="text-fg-4" aria-hidden />
        First snapshot recorded — your week-over-week change appears here once you return.
      </div>
    );
  }
  const up = digest.weekDelta > 0;
  const flat = digest.weekDelta === 0;
  const color = up ? 'text-success' : flat ? 'text-fg-3' : 'text-danger';
  const Icon = up ? TrendingUp : flat ? Minus : TrendingDown;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-hairline bg-bg-1 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
          Since last week
        </p>
        <p className={cn('mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold', color)}>
          <Icon size={15} strokeWidth={2.2} aria-hidden />
          {up ? '+' : ''}
          {digest.weekDelta} pts
          {hasTarget && weekValueDelta !== 0 ? (
            <span className="text-[12px] font-medium text-fg-4">
              · {weekValueDelta > 0 ? '+' : ''}
              {compactMoney(weekValueDelta)} projected
            </span>
          ) : null}
        </p>
      </div>
      <p className="text-[11px] text-fg-4">
        <span className="font-semibold tabular-nums text-fg-2">{digest.trackedDays}</span> day
        {digest.trackedDays === 1 ? '' : 's'} tracked
      </p>
    </div>
  );
}

/* ── Trajectory chart ──────────────────────────────────────────────────── */

const CHART_W = 320;
const CHART_H = 96;

/**
 * Past trend (solid) flowing into the projected curve (dashed), on a fixed
 * 0–100 scale so the institutional-bar reference line is meaningful. Pure SVG,
 * tone-driven, reduced-motion safe (no animation).
 */
function TrajectoryChart({
  past,
  trajectory
}: {
  past: number[];
  trajectory: ReadinessTrajectory;
}) {
  const futureScores = trajectory.points.map((p) => p.score);
  // Shared "now" point: the last past snapshot, or the projection's start.
  const nowX = past.length > 0 ? past.length - 1 : 0;
  const maxWeek = trajectory.points.length - 1;
  const maxX = nowX + maxWeek;

  const x = (i: number) => (maxX > 0 ? (i / maxX) * CHART_W : 0);
  const y = (v: number) => CHART_H - (Math.max(0, Math.min(100, v)) / 100) * CHART_H;

  const pastPath = past.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(v)}`).join(' ');
  const futurePath = futureScores
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(nowX + i)} ${y(v)}`)
    .join(' ');
  const barY = y(INSTITUTIONAL_BAR);

  const lastFuture = trajectory.points[trajectory.points.length - 1];
  const crossX = trajectory.weeksToBar !== null ? x(nowX + trajectory.weeksToBar) : null;

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      width="100%"
      height={CHART_H}
      role="img"
      aria-label={`Readiness trajectory. Now ${futureScores[0]} of 100, projected ${lastFuture.score} in ${maxWeek} weeks. Institutional bar at ${INSTITUTIONAL_BAR}.`}
      className="block"
      preserveAspectRatio="none"
    >
      {/* Institutional bar reference */}
      <line
        x1={0}
        y1={barY}
        x2={CHART_W}
        y2={barY}
        stroke="var(--fg-5)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      {/* Cross-the-bar marker */}
      {crossX !== null ? (
        <line
          x1={crossX}
          y1={0}
          x2={crossX}
          y2={CHART_H}
          stroke="var(--success)"
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.5}
        />
      ) : null}
      {/* Projection (dashed) */}
      <path
        d={futurePath}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeDasharray="4 3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* History (solid) */}
      {past.length >= 2 ? (
        <path
          d={pastPath}
          fill="none"
          stroke="var(--fg-3)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {/* Now marker */}
      <circle cx={x(nowX)} cy={y(futureScores[0])} r={3} fill="var(--accent)" />
    </svg>
  );
}

/** One-line read of the projection: when (and whether) it reaches the bar. */
function TrajectoryCaption({
  trajectory,
  target
}: {
  trajectory: ReadinessTrajectory;
  target: number;
}) {
  const last = trajectory.points[trajectory.points.length - 1];
  const weeks = trajectory.points.length - 1;
  const reachesBar = trajectory.weeksToBar !== null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="text-[11.5px] text-fg-3">
        {reachesBar ? (
          <>
            At ~{trajectory.pacePerWeek} pts/week, you clear the institutional bar in{' '}
            <span className="font-semibold text-success">
              {trajectory.weeksToBar} week{trajectory.weeksToBar === 1 ? '' : 's'}
            </span>
            .
          </>
        ) : (
          <>
            At ~{trajectory.pacePerWeek} pts/week you reach{' '}
            <span className="font-semibold text-fg-1">{last.score}</span> in {weeks} weeks — keep
            the cadence up to clear the bar.
          </>
        )}
      </p>
      <p className="text-[11px] text-fg-4">
        <span className="inline-block h-0.5 w-4 align-middle [border-top:2px_dashed_var(--accent)]" />{' '}
        projected
        {target > 0 ? (
          <>
            {' '}
            ·{' '}
            <span className="font-semibold tabular-nums text-fg-2">
              {compactMoney(last.projected)}
            </span>{' '}
            in {weeks}w
          </>
        ) : null}
      </p>
    </div>
  );
}

/* ── Ranked move row ───────────────────────────────────────────────────── */

/** A secondary move in the ranked list (rank ≥ 2). */
function MoveRow({ move, rank, target }: { move: RankedDimension; rank: number; target: number }) {
  const tone = toneForScore(move.score);
  const next = DIMENSION_NEXT_ACTION[move.dimension];
  const maxed = move.gap === 0;
  return (
    <li className="rounded-xl border border-hairline bg-bg-1 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-fg-1">
          <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-surface-2 text-[10px] tabular-nums text-fg-3">
            {rank}
          </span>
          {DIMENSION_LABEL[move.dimension]}
        </span>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color: tone.color }}>
          {move.score}
          <span className="text-fg-5"> / 100</span>
        </span>
      </div>
      {maxed ? (
        <p className="mt-2 pl-7 text-[11.5px] font-semibold text-success">Maxed — nice work.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pl-7">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <Stat label="+points" value={move.lift.toFixed(1)} />
            {target > 0 ? (
              <Stat label="unlocks" value={compactMoney(move.valueUnlock)} accent />
            ) : (
              <Stat label="gap" value={`${move.gap} pts`} />
            )}
          </div>
          <a
            href={next.href}
            className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-azure-1 hover:underline"
          >
            {next.cta}
            <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
          </a>
        </div>
      )}
    </li>
  );
}

/* ── Explore the model (what-if + radar, collapsed) ────────────────────── */

/**
 * The exploratory depth — drag-to-simulate and the balance radar — behind a
 * native disclosure so the first screen stays a decision, not a dashboard. The
 * simulator is self-contained: it recomputes its own compound/value off draft
 * scores and never touches the live standing above.
 */
function ExploreModel({
  breakdown,
  target
}: {
  breakdown: ReadinessDimensionScore[];
  target: number;
}) {
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

  const sim = useMemo(() => {
    const simBreakdown: ReadinessDimensionScore[] = breakdown.map((d) => ({
      ...d,
      score: draft[d.dimension],
      contribution: (draft[d.dimension] * d.weight) / 100
    }));
    const c = computeCompoundReadiness(simBreakdown);
    return { compound: c, value: computeReadinessValue(c, target) };
  }, [draft, breakdown, target]);

  const axes: RadarAxis[] = breakdown.map((d) => ({
    label: DIMENSION_LABEL[d.dimension],
    value: draft[d.dimension]
  }));

  return (
    <details className="group rounded-2xl border border-hairline bg-surface-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-fg-1">
          <SlidersHorizontal size={15} strokeWidth={2} aria-hidden />
          Explore the model — what-if &amp; balance
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className="text-fg-4 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <div className="grid gap-5 border-t border-hairline p-5 @container lg:grid-cols-[1.15fr_1fr]">
        {/* What-if simulator */}
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[12.5px] font-semibold text-fg-1">Drag to see the compounding</p>
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
              const isFoundation =
                sim.compound.dimensions.find((x) => x.dimension === dim)?.kind === 'foundation';
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
            <SimStat label="Compound" value={sim.compound.compoundScore} suffix="/100" />
            <SimStat label="Synergy" value={Math.round(sim.compound.synergy * 100)} suffix="%" />
            <SimStat
              label="Balance bonus"
              value={Math.round(sim.compound.balanceBonus)}
              suffix="pts"
            />
          </div>
          {target > 0 ? (
            <p className="mt-2 text-center text-[11.5px] text-fg-3">
              Projected closeable:{' '}
              <span className="font-semibold text-success">
                {compactMoney(sim.value.projected)}
              </span>
            </p>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed text-fg-4">
            Foundation (Profile · Proof) sets{' '}
            <span className="font-semibold text-fg-2">synergy</span> — execution counts for more
            once you&apos;re credible. Clear every link past 40 and the loop earns a{' '}
            <span className="font-semibold text-fg-2">balance bonus</span>.
          </p>
        </div>

        {/* Radar */}
        <div className="flex flex-col items-center">
          <p className="mb-2 self-start text-[12.5px] font-semibold text-fg-1">
            Balance across the five
          </p>
          <RadarChart
            axes={axes}
            ariaLabel={`Readiness radar. ${breakdown
              .map((d) => `${DIMENSION_LABEL[d.dimension]} ${draft[d.dimension]} of 100`)
              .join(', ')}.`}
          />
          <p className="mt-2 text-center text-[11px] text-fg-4">
            A round shape compounds; a spiky one leaks value through its weakest link{' '}
            <span className="font-semibold text-fg-2">
              ({DIMENSION_LABEL[sim.compound.weakestLink]})
            </span>
            .
          </p>
        </div>
      </div>
    </details>
  );
}

/* ── small presentational helpers ─────────────────────────────────────── */

/** Pill showing the compound multiplier, framed as "reinforcing" (≥1) or "drag" (<1). */
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

/** Headline dollar figure (projected/locked) with a label and one-line hint; shows "—" at zero. */
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

/** A single what-if simulator readout: a large number with a unit suffix over a caption. */
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

/** Inline value + caption chip used in move rows and the #1 move (points, $ unlock). */
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn('font-semibold tabular-nums', accent ? 'text-success' : 'text-fg-1')}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-[0.08em] text-fg-4">{label}</span>
    </span>
  );
}

export default ReadinessView;
