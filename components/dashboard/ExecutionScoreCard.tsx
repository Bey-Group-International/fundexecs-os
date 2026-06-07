import { Flame, Zap } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ExecutionScore } from '@/lib/queries/dashboard';

const LAYER_META: Record<
  keyof ExecutionScore['layers'],
  { label: string; color: string; soft: string; line: string }
> = {
  truth: {
    label: 'Truth',
    color: 'var(--proof-truth)',
    soft: 'rgba(56,189,248,0.10)',
    line: 'rgba(56,189,248,0.32)'
  },
  concept: {
    label: 'Concept',
    color: 'var(--proof-concept)',
    soft: 'rgba(167,139,250,0.10)',
    line: 'rgba(167,139,250,0.32)'
  },
  execution: {
    label: 'Execution',
    color: 'var(--proof-execution)',
    soft: 'rgba(251,191,36,0.10)',
    line: 'rgba(251,191,36,0.32)'
  },
  work: {
    label: 'Work',
    color: 'var(--proof-work)',
    soft: 'rgba(52,211,153,0.10)',
    line: 'rgba(52,211,153,0.32)'
  }
};

export interface ExecutionScoreCardProps {
  execution: ExecutionScore;
  className?: string;
}

/**
 * ExecutionScoreCard — the front-facing Execution Score. Big tabular number,
 * four Chain-of-Trust layer bars (Truth · Concept · Execution · Work), and a
 * compact XP / level / streak strip. The score is weighted toward the later
 * layers (`buildExecutionScore` in the loader) — proving you ship, not just
 * plan. All tones reference the proof-layer tokens already in `globals.css`.
 */
export function ExecutionScoreCard({ execution, className }: ExecutionScoreCardProps) {
  const layerOrder: Array<keyof ExecutionScore['layers']> = [
    'truth',
    'concept',
    'execution',
    'work'
  ];
  return (
    <Card className={cn('p-5', className)} data-testid="execution-score-card">
      <SectionTitle
        eyebrow="Execution score · Chain of Trust"
        title="Documented as it forms"
        className="mb-3"
      />

      <div className="flex items-end justify-between gap-3">
        <div>
          <p
            data-testid="execution-score-value"
            className="text-[40px] font-semibold tabular-nums leading-none tracking-[-0.025em] text-fg-1"
          >
            {execution.score}
          </p>
          <p className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            / 100 weighted
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="execution-score-level"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-1 text-[10.5px] font-semibold text-gold-1"
          >
            <Zap size={11} strokeWidth={2} aria-hidden />L{execution.level} ·{' '}
            {execution.xp.toLocaleString()} XP
          </span>
          <span
            data-testid="execution-score-streak"
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-2 py-1 text-[10.5px] font-semibold text-fg-3"
            title={
              execution.streak > 0
                ? `${execution.streak}-day streak`
                : 'Build a streak — be on the record daily'
            }
          >
            <Flame size={11} strokeWidth={2} aria-hidden />
            {execution.streak}-day streak
          </span>
        </div>
      </div>

      <ul className="mt-4 grid gap-1.5 sm:grid-cols-2" data-testid="execution-score-layers">
        {layerOrder.map((layer) => {
          const meta = LAYER_META[layer];
          const pct = execution.layers[layer];
          return (
            <li
              key={layer}
              data-testid={`execution-layer-${layer}`}
              className="rounded-xl border bg-bg-1 px-3 py-2.5"
              style={{ borderColor: meta.line, backgroundColor: meta.soft }}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className="text-[10.5px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </span>
                <span
                  className="text-[14px] font-semibold tabular-nums tracking-[-0.01em]"
                  style={{ color: meta.color }}
                >
                  {pct}%
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: meta.color }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
