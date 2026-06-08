import { ArrowRight, Lock, Sparkles } from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import type { ReadinessDimensionScore } from '@/lib/lifecycle';

/**
 * Lifecycle + posture hero for `/strategy`. Surfaces where the operator is in
 * the seven-stage capital-formation loop, the Institutional Readiness composite
 * an LP would broadly agree with, and — the compounding part — exactly which
 * stage the current one unlocks. All values come from the tested lifecycle
 * engine via `getDashboardData`; nothing here is fabricated.
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
  /** 0–100 institutional-readiness composite. */
  readinessScore: number;
  /** Per-dimension readiness breakdown (profile/proof/materials/pipeline/capital). */
  readinessBreakdown: ReadinessDimensionScore[];
  /** Label of the stage the current one unlocks, or null at the final stage. */
  nextStageLabel: string | null;
  /** What unlocks once the current stage's gate clears. */
  nextStageBlurb: string | null;
}

const DIMENSION_LABEL: Record<string, string> = {
  profile: 'Profile',
  proof: 'Proof',
  materials: 'Materials',
  pipeline: 'Pipeline',
  capital: 'Capital'
};

/** Readiness band → tone + one-word standing, so the number reads as a posture. */
function readinessBand(score: number): { tone: 'success' | 'gold' | 'warning'; label: string } {
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
  readinessScore,
  readinessBreakdown,
  nextStageLabel,
  nextStageBlurb
}: StrategyHeroProps) {
  const band = readinessBand(readinessScore);

  return (
    <Card className="grid gap-5 p-[18px] lg:grid-cols-[1.4fr_1fr]">
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
            <Lock size={13} strokeWidth={1.9} className="mt-px flex-none text-gold-1" aria-hidden />
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

      {/* Right: Institutional Readiness composite + per-dimension breakdown. */}
      <div className="flex flex-col rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Institutional readiness
          </span>
          <Badge tone={band.tone} dot>
            {band.label}
          </Badge>
        </div>
        <div className="my-1 flex items-baseline gap-1.5">
          <span className="text-[34px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-fg-1">
            {readinessScore}
          </span>
          <span className="text-[13px] font-medium text-fg-4">/ 100</span>
        </div>
        <p className="text-[11px] leading-relaxed text-fg-5">
          How investable you are right now — the number an LP would broadly agree with.
        </p>

        <div className="mt-3 flex flex-col gap-2 border-t border-hairline pt-3">
          {readinessBreakdown.map((d) => (
            <div key={d.dimension} className="flex items-center gap-2.5">
              <span className="w-[58px] flex-none text-[10.5px] font-medium text-fg-4">
                {DIMENSION_LABEL[d.dimension] ?? d.dimension}
              </span>
              <div className="flex-1">
                <ProgressBar
                  value={d.score}
                  color="var(--azure-1)"
                  height={4}
                  ariaLabel={`${DIMENSION_LABEL[d.dimension] ?? d.dimension} readiness`}
                />
              </div>
              <span className="w-[26px] flex-none text-right text-[10.5px] tabular-nums text-fg-3">
                {d.score}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
