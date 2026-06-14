import Link from 'next/link';
import { ArrowRight, ListChecks, Radar, Sparkles, Clock } from 'lucide-react';
import type { ChiefOfStaffBrief } from '@/lib/queries/chief-of-staff-brief';

/* The Chief-of-Staff brief: a read-only glance at what the desk has prepared
 * and the operator's next decision. Every line deep-links to where the work is.
 * Renders nothing when there's nothing to surface (no empty noise). */
export function DailyBrief({ brief }: { brief: ChiefOfStaffBrief }) {
  const hasSomething =
    brief.pendingApprovalsCount > 0 ||
    brief.newMatchesCount > 0 ||
    brief.overdueCount > 0 ||
    !!brief.briefing;

  if (!hasSomething) return null;

  return (
    <section className="mb-4 rounded-[14px] border border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
      <header className="flex items-center gap-2">
        <Sparkles size={16} className="text-gold-1" aria-hidden />
        <h2 className="text-[13.5px] font-semibold text-fg-1">Your desk brief</h2>
      </header>

      {brief.briefing?.body && (
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">{brief.briefing.body}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {brief.pendingApprovalsCount > 0 && (
          <Link
            href="/action-queue"
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-3 py-1 text-[12px] font-medium text-fg-1 transition hover:bg-surface-2"
          >
            <ListChecks size={13} className="text-accent" aria-hidden />
            {brief.pendingApprovalsCount} awaiting approval
            <ArrowRight size={12} aria-hidden />
          </Link>
        )}
        {brief.newMatchesCount > 0 && (
          <Link
            href="/match-inbox"
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-3 py-1 text-[12px] font-medium text-fg-1 transition hover:bg-surface-2"
          >
            <Radar size={13} className="text-azure-1" aria-hidden />
            {brief.newMatchesCount} new signal {brief.newMatchesCount === 1 ? 'match' : 'matches'}
            <ArrowRight size={12} aria-hidden />
          </Link>
        )}
        {brief.overdueCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warning-line)] bg-[var(--warning-soft)] px-3 py-1 text-[12px] font-medium text-warning">
            <Clock size={13} aria-hidden />
            {brief.overdueCount} overdue
          </span>
        )}
      </div>

      {brief.pendingApprovals.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {brief.pendingApprovals.map((run) => (
            <li key={run.runId}>
              <Link
                href="/action-queue"
                className="flex items-center justify-between gap-2 rounded-[10px] border border-hairline bg-surface-1 px-3 py-2 text-[12.5px] transition hover:bg-surface-2"
              >
                <span className="min-w-0 truncate text-fg-2">
                  <span className="font-medium text-fg-1">{run.agentName}</span> — {run.taskTitle}
                </span>
                <ArrowRight size={13} className="flex-none text-fg-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
