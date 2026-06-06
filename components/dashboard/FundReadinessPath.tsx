import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';

export type ReadinessStatus = 'complete' | 'active' | 'upcoming';

export interface FundReadinessStage {
  id: string;
  /** Stage name (e.g. "Thesis", "Data room", "IC approval"). */
  name: string;
  /** Short hint shown under the name. */
  hint?: string;
  /** Completion 0–100 (only rendered when status === 'active'). */
  pct?: number;
  status: ReadinessStatus;
}

export interface FundReadinessPathProps {
  stages: FundReadinessStage[];
  /** Heading override. */
  title?: string;
  /** Eyebrow override. */
  eyebrow?: string;
  /** Optional overall completion shown right-aligned in the header. */
  overallPct?: number;
  className?: string;
}

const STATUS_COLOR: Record<ReadinessStatus, string> = {
  complete: 'var(--success)',
  active: 'var(--accent)',
  upcoming: 'var(--fg-5)'
};

/**
 * FundReadinessPath — a horizontal multi-stage progress strip used in the
 * Investment Firm dashboard to show how close the active raise / IC pack /
 * data room sits to "ready". Token-driven hues; mobile collapses to a
 * scrollable horizontal row.
 */
export function FundReadinessPath({
  stages,
  title = 'Fund Readiness',
  eyebrow = 'Path to next close',
  overallPct,
  className
}: FundReadinessPathProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="fund-readiness-path">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow={eyebrow} title={title} />
        {typeof overallPct === 'number' && (
          <span className="text-[11px] font-semibold tabular-nums text-fg-3">
            {overallPct}% ready
          </span>
        )}
      </div>
      <ol
        className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0"
        data-testid="fund-readiness-stages"
      >
        {stages.map((stage, idx) => {
          const isLast = idx === stages.length - 1;
          const Icon =
            stage.status === 'complete'
              ? CheckCircle2
              : stage.status === 'active'
                ? Loader2
                : Circle;
          return (
            <li
              key={stage.id}
              data-testid={`fund-readiness-stage-${stage.id}`}
              className={cn(
                'relative flex flex-1 items-start gap-3 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5',
                'lg:flex-col lg:items-start lg:rounded-none lg:border-0 lg:bg-transparent lg:px-3 lg:py-0',
                !isLast && 'lg:pr-6'
              )}
            >
              {/* Connector — desktop only */}
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute right-0 top-3 hidden h-px w-full bg-hairline lg:block"
                />
              )}
              <span
                className={cn(
                  'flex h-6 w-6 flex-none items-center justify-center rounded-full border bg-bg-1',
                  stage.status === 'complete' && 'border-[var(--success-line)]',
                  stage.status === 'active' && 'border-[var(--accent-line)]',
                  stage.status === 'upcoming' && 'border-hairline'
                )}
                style={{ color: STATUS_COLOR[stage.status] }}
              >
                <Icon
                  size={14}
                  strokeWidth={2}
                  className={stage.status === 'active' ? 'animate-spin-slow' : undefined}
                  aria-hidden
                />
              </span>
              <div className="min-w-0 lg:mt-2">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-fg-4">
                  Stage {idx + 1}
                </p>
                <p className="text-[13px] font-semibold text-fg-1">{stage.name}</p>
                {stage.hint && (
                  <p className="mt-0.5 truncate text-[11px] text-fg-4">{stage.hint}</p>
                )}
                {stage.status === 'active' && typeof stage.pct === 'number' && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div
                      className="h-1 w-20 overflow-hidden rounded-full bg-surface-2"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={stage.pct}
                      aria-label={`${stage.name} progress`}
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${stage.pct}%`,
                          backgroundColor: STATUS_COLOR.active
                        }}
                      />
                    </div>
                    <span className="text-[10.5px] tabular-nums text-fg-3">{stage.pct}%</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
