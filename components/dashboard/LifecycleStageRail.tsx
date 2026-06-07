import { Check } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { LIFECYCLE_STAGES, LIFECYCLE_STAGE_LABELS, type LifecycleStage } from '@/lib/lifecycle';
import { cn } from '@/lib/utils';

export interface LifecycleStageRailProps {
  /** Current lifecycle stage — the first un-cleared gate. */
  stage: LifecycleStage;
  /** Stage one-liner blurb (rendered next to the rail). */
  stageBlurb: string;
  /** 0–100 progress across the seven-stage loop. */
  loopProgress: number;
  className?: string;
}

const STAGE_LABEL_SHORT: Record<LifecycleStage, string> = {
  establish_truth: 'Truth',
  get_raise_ready: 'Raise-ready',
  source_lps: 'Source LPs',
  convert_lps: 'Convert',
  source_deals: 'Deals',
  operate: 'Operate',
  prove: 'Prove'
};

/**
 * LifecycleStageRail — seven-step horizontal stage strip that anchors the
 * Dashboard hero. Stages before the current are marked cleared (Check icon),
 * the current stage carries an azure pulse, future stages render dim. The
 * accompanying blurb + percentage make the spec's loop-progress legible at
 * a glance.
 */
export function LifecycleStageRail({
  stage,
  stageBlurb,
  loopProgress,
  className
}: LifecycleStageRailProps) {
  const currentIndex = LIFECYCLE_STAGES.indexOf(stage);

  return (
    <Card className={cn('p-5', className)} data-testid="lifecycle-stage-rail">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <SectionTitle
          eyebrow={`Lifecycle · ${loopProgress}% through the loop`}
          title={LIFECYCLE_STAGE_LABELS[stage]}
        />
        <p className="max-w-[44ch] text-[12px] text-fg-3 sm:text-right">{stageBlurb}</p>
      </div>

      <ol
        className="flex items-stretch gap-1.5 overflow-x-auto pb-1"
        data-testid="lifecycle-stage-rail-steps"
        aria-label="Capital-formation lifecycle progress"
      >
        {LIFECYCLE_STAGES.map((s, idx) => {
          const cleared = idx < currentIndex;
          const current = idx === currentIndex;
          return (
            <li
              key={s}
              data-testid={`lifecycle-stage-${s}`}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex min-w-[124px] flex-1 flex-col gap-2 rounded-xl border bg-bg-1 px-3 py-2.5 transition',
                cleared && 'border-[var(--success-line)] bg-[var(--success-soft)]',
                current &&
                  'border-[var(--accent-line)] bg-[var(--accent-soft)] shadow-[var(--shadow-md)]',
                !cleared && !current && 'border-hairline opacity-60'
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-[0.12em]',
                    current ? 'text-azure-1' : cleared ? 'text-success' : 'text-fg-5'
                  )}
                >
                  Step {String(idx + 1).padStart(2, '0')}
                </span>
                {cleared ? (
                  <Check size={12} strokeWidth={2.4} className="text-success" aria-hidden />
                ) : current ? (
                  <span aria-hidden className="relative inline-flex h-2 w-2">
                    <span className="absolute inset-0 animate-ping rounded-full bg-azure-1 opacity-60" />
                    <span className="relative inline-block h-2 w-2 rounded-full bg-azure-1" />
                  </span>
                ) : null}
              </div>
              <div
                className={cn(
                  'text-[12.5px] font-semibold tracking-[-0.005em]',
                  current ? 'text-fg-1' : cleared ? 'text-fg-2' : 'text-fg-3'
                )}
              >
                {STAGE_LABEL_SHORT[s]}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
