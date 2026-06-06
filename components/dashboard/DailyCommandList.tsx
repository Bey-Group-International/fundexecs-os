import Link from 'next/link';
import { CircleDot, ArrowUpRight } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
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
 * DailyCommandList — today's prioritized operating loop. Each entry shows
 * its tone-coded dot, headline, one-line context, source-style "open here"
 * arrow CTA. Numbered so the manager reads it as a checklist, not a list of
 * suggestions. Empty state stays calm.
 */
export function DailyCommandList({ actions, className }: DailyCommandListProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="daily-command-list">
      <SectionTitle
        eyebrow="Daily command · prioritized"
        title="What to operate on today"
        className="mb-3"
      />
      {actions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-5 text-center">
          <p className="text-[12px] text-fg-3">
            Nothing queued — Earn will surface ranked moves as soon as one is needed.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5" data-testid="daily-command-list-items">
          {actions.map((action, idx) => (
            <li key={action.id}>
              <Link
                href={action.href}
                data-testid={`daily-command-item-${action.id}`}
                className="group flex items-start gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 transition-[background,transform,box-shadow] hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-sm)]"
              >
                <span
                  aria-hidden
                  className={cn('mt-2 h-1.5 w-1.5 flex-none rounded-full', TONE_DOT[action.tone])}
                />
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-3 group-hover:text-fg-1">
                  <CircleDot size={13} strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] font-semibold tabular-nums text-fg-5">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <p className="truncate text-[12.5px] font-semibold text-fg-1">{action.title}</p>
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
          ))}
        </ol>
      )}
    </Card>
  );
}
