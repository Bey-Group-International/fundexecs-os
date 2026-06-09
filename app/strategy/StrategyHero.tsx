import { ArrowRight, Lock, Sparkles, Flame, TrendingUp, TrendingDown } from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import type { PostureLane } from '@/lib/strategy/posture';

/**
 * Lifecycle + posture hero for `/strategy`. Surfaces where the operator is in
 * the seven-stage capital-formation loop, the four-lane Institutional Posture
 * scorecard (Compliance · Governance · Execution · Capital), and — the
 * compounding part — which stage the current one unlocks, plus streak +
 * capital momentum. All values come from tested engines; nothing is fabricated.
 */
export interface StrategyHeroProps {
  stageLabel: string;
  stageBlurb: string;
  /** 0-based ordinal of the current stage in the seven-stage loop. */
  stageIndex: number;
  /** Total number of lifecycle stages (for the "stage n of N" eyebrow). */
  stageCount: number;
  /** 0–100 progress through the seven-stage loop. */
  loopProgress: number;
  /** 0–100 institutional-posture composite. */
  postureScore: number;
  /** Per-lane posture breakdown (compliance/governance/execution/capital). */
  postureLanes: PostureLane[];
  /** Consecutive-active-day streak (0 when none). */
  streak: number;
  /** Committed-capital momentum over the last 8 weeks, % change (null = flat). */
  momentumDeltaPct: number | null;
  /** Label of the stage the current one unlocks, or null at the final stage. */
  nextStageLabel: string | null;
  /** What unlocks once the current stage's gate clears. */
  nextStageBlurb: string | null;
  /** Active (non-archived) objective count — folds in the old Earn banner. */
  objectiveCount: number;
}

/** Posture band → tone + one-word standing, so the number reads as a posture. */
function postureBand(score: number): { tone: 'success' | 'gold' | 'warning'; label: string } {
  if (score >= 75) return { tone: 'success', label: 'Institutional' };
  if (score >= 50) return { tone: 'gold', label: 'Emerging' };
  return { tone: 'warning', label: 'Building' };
}

export function StrategyHero({
  stageLabel,
  stageBlurb,
  stageIndex,
  stageCount,
  loopProgress,
  postureScore,
  postureLanes,
  streak,
  momentumDeltaPct,
  nextStageLabel,
  nextStageBlurb,
  objectiveCount
}: StrategyHeroProps) {
  const band = postureBand(postureScore);
  const momentumUp = (momentumDeltaPct ?? 0) >= 0;

  return (
    <Card className="flex flex-col gap-4 p-[18px]">
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Left: where you are in the loop + what it unlocks. */}
        <div className="flex flex-col">
          <SectionTitle
            eyebrow={`Lifecycle · stage ${stageIndex + 1} of ${stageCount}`}
            title={stageLabel}
            className="mb-2"
          />
          <p className="max-w-md text-[12.5px] leading-relaxed text-fg-4">{stageBlurb}</p>

          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Loop progress
              </span>
              <span className="text-[12px] font-semibold tabular-nums text-fg-2">
                {loopProgress}%
              </span>
            </div>
            <ProgressBar
              value={loopProgress}
              color="var(--azure-1)"
              height={6}
              ariaLabel="Progress through the seven-stage lifecycle loop"
            />
          </div>

          {/* The compounding line: what clearing this stage's gate unlocks next. */}
          {nextStageLabel ? (
            <div className="mt-4 flex items-start gap-2.5 rounded-[10px] border border-[var(--gold-line)] bg-[rgba(247,201,72,0.05)] px-3 py-2.5">
              <Lock
                size={13}
                strokeWidth={1.9}
                className="mt-px flex-none text-gold-1"
                aria-hidden
              />
              <span className="text-[11.5px] leading-relaxed text-fg-2">
                <span className="font-semibold text-gold-1">Clear this stage to unlock</span>{' '}
                <span className="inline-flex items-center gap-1 font-semibold text-fg-1">
                  <ArrowRight size={11} strokeWidth={2.2} aria-hidden />
                  {nextStageLabel}
                </span>
                {nextStageBlurb ? <span className="text-fg-4"> — {nextStageBlurb}</span> : null}
              </span>
            </div>
          ) : (
            <div className="mt-4 flex items-start gap-2.5 rounded-[10px] border border-[var(--success-line)] bg-[var(--success-soft)] px-3 py-2.5">
              <Sparkles
                size={13}
                strokeWidth={1.9}
                className="mt-px flex-none text-success"
                aria-hidden
              />
              <span className="text-[11.5px] leading-relaxed text-fg-2">
                <span className="font-semibold text-success">Every gate cleared.</span> You&rsquo;re
                in the compounding end-state — make every action auditable and reusable.
              </span>
            </div>
          )}
        </div>

        {/* Right: Institutional Posture scorecard + per-lane breakdown. */}
        <div className="flex flex-col rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Institutional posture
            </span>
            <Badge tone={band.tone} dot>
              {band.label}
            </Badge>
          </div>
          <div className="my-1 flex items-baseline gap-1.5">
            <span className="text-[34px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-fg-1">
              {postureScore}
            </span>
            <span className="text-[13px] font-medium text-fg-4">/ 100</span>
          </div>
          <p className="text-[11px] leading-relaxed text-fg-5">
            How you&rsquo;d hold up to institutional diligence right now.
          </p>

          <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3">
            {postureLanes.map((lane) => (
              <div key={lane.key} className="flex items-center gap-2.5">
                <span className="w-[72px] flex-none text-[10.5px] font-medium text-fg-4">
                  {lane.label}
                </span>
                <div className="flex-1">
                  <ProgressBar
                    value={lane.score}
                    color="var(--azure-1)"
                    height={4}
                    ariaLabel={`${lane.label} posture`}
                  />
                </div>
                <span className="w-[26px] flex-none text-right text-[10.5px] tabular-nums text-fg-3">
                  {lane.score}
                </span>
              </div>
            ))}
          </div>

          {/* Momentum + streak — felt progress, no new tables. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline pt-2.5 text-[11px] text-fg-3">
            <span className="flex items-center gap-1.5">
              <Flame size={12} strokeWidth={1.9} className="text-gold-1" aria-hidden />
              Day {streak} streak
            </span>
            {momentumDeltaPct != null && (
              <span className="flex items-center gap-1.5">
                {momentumUp ? (
                  <TrendingUp size={12} strokeWidth={1.9} className="text-success" aria-hidden />
                ) : (
                  <TrendingDown size={12} strokeWidth={1.9} className="text-warning" aria-hidden />
                )}
                {momentumUp ? '+' : ''}
                {momentumDeltaPct}% capital · 8 wks
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Earn strip — folds the old standalone banner into the hero so the page
          leads with a single summary surface. */}
      <div className="flex items-center gap-3 border-t border-hairline pt-3.5">
        <EarnCoin size={30} glow />
        <p className="min-w-0 flex-1 text-[12px] text-fg-3">
          <span className="font-semibold text-fg-1">Earnest Fundmaker</span> is tracking{' '}
          <span className="font-semibold text-gold-1">
            {objectiveCount} {objectiveCount === 1 ? 'objective' : 'objectives'}
          </span>{' '}
          across your 100 / 30 / 10 horizons.
        </p>
        <Badge tone="gold" dot className="flex-none">
          Execution ready
        </Badge>
      </div>
    </Card>
  );
}
