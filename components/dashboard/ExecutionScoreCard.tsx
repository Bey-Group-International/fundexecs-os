'use client';

import { useEffect, useRef, useState } from 'react';
import { Flame, Zap } from 'lucide-react';
import { Card, SectionTitle, AnimatedNumber } from '@/components/ui';
import { cn } from '@/lib/utils';
import { levelProgress } from '@/lib/gamification/progression';
import { RingGauge, type RingGaugeSegment } from './RingGauge';
import { CelebrationToast, type Celebration } from './CelebrationToast';
import type { ExecutionScore } from '@/lib/queries/dashboard';

const LAYER_META: Record<keyof ExecutionScore['layers'], { label: string; color: string }> = {
  truth: { label: 'Truth', color: 'var(--proof-truth)' },
  concept: { label: 'Concept', color: 'var(--proof-concept)' },
  execution: { label: 'Execution', color: 'var(--proof-execution)' },
  work: { label: 'Work', color: 'var(--proof-work)' }
};

const LAYER_ORDER: Array<keyof ExecutionScore['layers']> = [
  'truth',
  'concept',
  'execution',
  'work'
];

/** Persisted snapshot for detecting level-up / streak-high between visits. */
interface Snapshot {
  level: number;
  streak: number;
}

const STORAGE_KEY = 'fx-execution-snapshot';

export interface ExecutionScoreCardProps {
  execution: ExecutionScore;
  className?: string;
}

/**
 * ExecutionScoreCard — the bold, dimensional Execution Score. An animated SVG
 * ring gauge (count-up, depth glow) anchors the 0–100 weighted score; the four
 * Chain-of-Trust layers ride the same ring as segments (not flat bars). A gold
 * XP-to-next-level bar, a flame streak with personal-best, and a daily-loop
 * completion ring make the progression felt. Level-ups and new streak highs
 * fire a single, reduced-motion-safe celebration moment. Keeps the
 * `ExecutionScore` data contract.
 */
export function ExecutionScoreCard({ execution, className }: ExecutionScoreCardProps) {
  const level = levelProgress(execution.xp, execution.level);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const checked = useRef(false);

  // Detect level-up / new streak high vs the last persisted snapshot, fire one
  // celebration moment, then persist the new snapshot. Runs once per mount. The
  // celebration setState is deferred to a rAF (never synchronous in the effect
  // body) so the React-compiler set-state-in-effect lint stays clean.
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    let prev: Snapshot | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) prev = JSON.parse(raw) as Snapshot;
    } catch {
      prev = null;
    }

    let next: Celebration | null = null;
    if (prev) {
      if (execution.level > prev.level) {
        next = {
          kind: 'level-up',
          title: `Level ${execution.level} reached`,
          detail: 'Your verified work compounded into a new level. Keep shipping.'
        };
      } else if (execution.streak > prev.streak && execution.streak >= 2) {
        next = {
          kind: 'streak',
          title: `${execution.streak}-day streak`,
          detail: 'A new personal best for staying on the record. Nice rhythm.'
        };
      }
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ level: execution.level, streak: execution.streakBest })
      );
    } catch {
      /* storage unavailable — celebrations simply won't re-fire */
    }

    if (!next) return;
    const raf = requestAnimationFrame(() => setCelebration(next));
    return () => cancelAnimationFrame(raf);
  }, [execution.level, execution.streak, execution.streakBest]);

  const segments: RingGaugeSegment[] = LAYER_ORDER.map((layer) => ({
    value: execution.layers[layer],
    color: LAYER_META[layer].color,
    label: LAYER_META[layer].label
  }));

  const streakActive = execution.streak > 0;
  const dailyPct =
    execution.dailyTotal > 0 ? Math.round((execution.dailyDone / execution.dailyTotal) * 100) : 0;

  return (
    <Card
      className={cn('relative overflow-hidden p-5', className)}
      data-testid="execution-score-card"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: 'radial-gradient(80% 120% at 100% 0%, rgba(247,201,72,0.06), transparent 60%)'
        }}
      />
      <SectionTitle
        eyebrow="Execution score · Chain of Trust"
        title="Documented as it forms"
        className="mb-3"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Ring gauge — score in the center, CoT layers as ring segments */}
        <div className="flex flex-none justify-center">
          <RingGauge
            segments={segments}
            size={132}
            stroke={11}
            glow
            ariaLabel={`Execution score ${execution.score} of 100. Chain of Trust layers: ${LAYER_ORDER.map(
              (l) => `${LAYER_META[l].label} ${execution.layers[l]} percent`
            ).join(', ')}.`}
          >
            <AnimatedNumber
              value={execution.score}
              className="text-[34px] font-semibold leading-none tracking-[-0.025em] text-fg-1"
            />
            <span className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
              / 100 weighted
            </span>
          </RingGauge>
        </div>

        <div className="min-w-0 flex-1">
          {/* XP → next level */}
          <div className="rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span
                data-testid="execution-score-level"
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gold-1"
              >
                <Zap size={12} strokeWidth={2} aria-hidden />
                Level {execution.level}
              </span>
              <span className="text-[10px] font-semibold tabular-nums text-gold-1">
                <AnimatedNumber value={execution.xp} /> XP
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]"
              role="progressbar"
              aria-valuenow={level.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${level.toNext} XP to level ${execution.level + 1}`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{
                  width: `${level.pct}%`,
                  background: 'var(--cta-gradient, var(--gold-1))'
                }}
              />
            </div>
            <p className="mt-1 text-[10px] text-gold-1/80">
              {level.toNext.toLocaleString()} XP to level {execution.level + 1}
            </p>
          </div>

          {/* Streak + daily loop */}
          <div className="mt-2 flex items-stretch gap-2">
            <div
              data-testid="execution-score-streak"
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2',
                streakActive
                  ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                  : 'border-hairline bg-bg-1'
              )}
            >
              <Flame
                size={18}
                strokeWidth={2}
                className={streakActive ? 'text-gold-1' : 'text-fg-5'}
                aria-hidden
              />
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-[14px] font-semibold leading-none tabular-nums',
                    streakActive ? 'text-gold-1' : 'text-fg-2'
                  )}
                >
                  {execution.streak}
                  <span className="ml-1 text-[10px] font-semibold">
                    day{execution.streak === 1 ? '' : 's'}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[9.5px] text-fg-4">
                  {streakActive ? `Best ${execution.streakBest}-day` : 'Be on the record daily'}
                </p>
              </div>
            </div>

            <div className="flex flex-none items-center gap-2 rounded-xl border border-hairline bg-bg-1 px-3 py-2">
              <RingGauge
                value={dailyPct}
                size={34}
                stroke={4}
                color="var(--success)"
                ariaLabel={`Daily loop ${execution.dailyDone} of ${execution.dailyTotal} done`}
              >
                <span className="text-[9px] font-semibold tabular-nums text-fg-2">
                  {execution.dailyDone}
                </span>
              </RingGauge>
              <div className="leading-tight">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-fg-4">
                  Daily loop
                </p>
                <p className="text-[10.5px] font-semibold tabular-nums text-fg-2">
                  {execution.dailyDone}/{execution.dailyTotal}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Layer legend — keys the ring segments to their labels + values */}
      <ul className="mt-4 grid grid-cols-2 gap-1.5" data-testid="execution-score-layers">
        {LAYER_ORDER.map((layer) => {
          const meta = LAYER_META[layer];
          const pct = execution.layers[layer];
          return (
            <li
              key={layer}
              data-testid={`execution-layer-${layer}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-bg-1 px-2.5 py-1.5"
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                  {meta.label}
                </span>
              </span>
              <span
                className="text-[12px] font-semibold tabular-nums"
                style={{ color: meta.color }}
              >
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>

      <CelebrationToast celebration={celebration} onDone={() => setCelebration(null)} />
    </Card>
  );
}

export default ExecutionScoreCard;
