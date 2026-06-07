'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Check, ArrowUpRight } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import { toggleDailyDone } from '@/lib/actions/dashboard';
import type { DashboardAction } from '@/lib/queries/dashboard';

const TONE_DOT: Record<DashboardAction['tone'], string> = {
  azure: 'bg-azure-1',
  gold: 'bg-gold-1',
  success: 'bg-success',
  warning: 'bg-warning'
};

export interface DailyCommandListProps {
  /** Today's prioritized action list — the daily operating loop. */
  actions: DashboardAction[];
  className?: string;
}

/**
 * DailyCommandList — today's prioritized operating loop, as a real checklist.
 * Each entry can be **checked off inline** (optimistic → `toggleDailyDone`
 * server action → day-scoped cookie); done items dim and strike through but
 * stay visible so progress is felt. The body still deep-links to the surface.
 */
export function DailyCommandList({ actions, className }: DailyCommandListProps) {
  const [done, setDone] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(actions.map((a) => [a.id, Boolean(a.done)]))
  );
  const [, startTransition] = useTransition();

  function handleToggle(id: string) {
    setDone((prev) => ({ ...prev, [id]: !prev[id] })); // optimistic
    startTransition(() => {
      void toggleDailyDone(id);
    });
  }

  const completed = actions.filter((a) => done[a.id]).length;

  return (
    <Card className={cn('p-5', className)} data-testid="daily-command-list">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="Daily command · prioritized" title="What to operate on today" />
        {actions.length > 0 ? (
          <span className="text-[10.5px] font-semibold tabular-nums text-fg-4">
            {completed}/{actions.length} done
          </span>
        ) : null}
      </div>
      {actions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-5 text-center">
          <p className="text-[12px] text-fg-3">
            Nothing queued — Earn will surface ranked moves as soon as one is needed.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5" data-testid="daily-command-list-items">
          {actions.map((action, idx) => {
            const isDone = done[action.id];
            return (
              <li
                key={action.id}
                className={cn(
                  'group flex items-start gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 transition-[background,transform,box-shadow] hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-sm)]',
                  isDone && 'opacity-60'
                )}
              >
                <button
                  type="button"
                  onClick={() => handleToggle(action.id)}
                  data-testid={`daily-command-toggle-${action.id}`}
                  aria-pressed={isDone}
                  aria-label={
                    isDone ? `Mark "${action.title}" not done` : `Mark "${action.title}" done`
                  }
                  className={cn(
                    'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-md border transition-colors',
                    isDone
                      ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                      : 'border-hairline bg-surface-1 text-transparent hover:border-[var(--accent-line)]'
                  )}
                >
                  <Check size={12} strokeWidth={3} aria-hidden />
                </button>
                <span
                  aria-hidden
                  className={cn('mt-2 h-1.5 w-1.5 flex-none rounded-full', TONE_DOT[action.tone])}
                />
                <Link
                  href={action.href}
                  data-testid={`daily-command-item-${action.id}`}
                  className="flex min-w-0 flex-1 items-start gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold tabular-nums text-fg-5">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <p
                        className={cn(
                          'truncate text-[12.5px] font-semibold text-fg-1',
                          isDone && 'line-through'
                        )}
                      >
                        {action.title}
                      </p>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-fg-3">{action.context}</p>
                  </div>
                  <span className="flex items-center gap-1 self-center text-[11px] font-semibold text-azure-1">
                    {action.cta}
                    <ArrowUpRight
                      size={12}
                      strokeWidth={2}
                      className="transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
