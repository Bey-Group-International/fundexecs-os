import { Check, Circle, Flag, Zap } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Quest } from '@/lib/queries/gamification';

export interface QuestProgressCardProps {
  quests: Quest[];
  /** When true, a small "coming soon" note marks this as pre-Phase-2 scaffold. */
  placeholder?: boolean;
  className?: string;
}

/**
 * QuestProgressCard — short, ordered missions with a step checklist and the XP
 * reward on completion. Each quest shows a thin completion bar over its steps;
 * the next incomplete step is highlighted as the focus. Honest pre-Phase-2:
 * quests render at step 0 until the live loader lights them up.
 */
export function QuestProgressCard({ quests, placeholder, className }: QuestProgressCardProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="quest-progress-card">
      <SectionTitle
        eyebrow="Quests · short missions"
        title="Earn's guided plays"
        className="mb-3"
      />

      {quests.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-5 text-center text-[12px] text-fg-3">
          Guided quests will appear here to compound your next best moves.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="quest-progress-items">
          {quests.map((q) => {
            const total = q.steps.length;
            const done = q.steps.filter((s) => s.done).length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const nextIdx = q.steps.findIndex((s) => !s.done);
            const complete = q.completedAt != null || (total > 0 && done === total);
            return (
              <li
                key={q.id}
                data-testid={`quest-${q.id}`}
                className={cn(
                  'rounded-xl border bg-bg-1 p-3',
                  complete ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]' : 'border-hairline'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg-1">
                      <Flag
                        size={12}
                        strokeWidth={2}
                        className={complete ? 'text-gold-1' : 'text-azure-1'}
                        aria-hidden
                      />
                      <span className="truncate">{q.title}</span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fg-3">
                      {q.description}
                    </p>
                  </div>
                  <span className="inline-flex flex-none items-center gap-1 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-0.5 text-[10px] font-semibold text-gold-1">
                    <Zap size={10} strokeWidth={2} aria-hidden />
                    {q.rewardXp.toLocaleString()} XP
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-2">
                  <span
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${q.title} — ${done} of ${total} steps`}
                  >
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        complete ? 'bg-gold-1' : 'bg-azure-1'
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="text-[10px] font-semibold tabular-nums text-fg-4">
                    {done}/{total}
                  </span>
                </div>

                <ol className="mt-2 flex flex-col gap-1">
                  {q.steps.map((s, i) => {
                    const isNext = i === nextIdx;
                    return (
                      <li
                        key={s.id}
                        className={cn(
                          'flex items-center gap-2 text-[11px]',
                          s.done ? 'text-fg-4' : isNext ? 'text-fg-1' : 'text-fg-3'
                        )}
                      >
                        {s.done ? (
                          <Check size={12} strokeWidth={3} className="text-success" aria-hidden />
                        ) : (
                          <Circle
                            size={11}
                            strokeWidth={2}
                            className={isNext ? 'text-azure-1' : 'text-fg-5'}
                            aria-hidden
                          />
                        )}
                        <span className={cn('truncate', s.done && 'line-through')}>{s.label}</span>
                        {isNext && !s.done ? (
                          <span className="ml-auto text-[9px] font-semibold uppercase tracking-[0.08em] text-azure-1">
                            Next
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ul>
      )}

      {placeholder ? (
        <p className="mt-3 text-[10.5px] text-fg-5">
          Preview · quests begin tracking when the intelligence layer ships.
        </p>
      ) : null}
    </Card>
  );
}

export default QuestProgressCard;
