import Link from 'next/link';
import { Target, ArrowRight, ListChecks, Radar, TimerReset, HeartHandshake } from 'lucide-react';
import type { ActionKind, NextAction } from '@/lib/intelligence/next-best-action';

/* The Next-Best-Action worklist: the desk's own intelligence (approvals,
 * stalled deals, cold relationships, low-conviction deals) fused into one
 * ranked list of what to do next. Pure read, key-free. Renders nothing when
 * there's nothing pressing. */

const KIND_ICON: Record<ActionKind, typeof Target> = {
  approval: ListChecks,
  velocity: TimerReset,
  reconnect: HeartHandshake,
  conviction: Radar
};

const KIND_TONE: Record<ActionKind, string> = {
  approval: 'text-accent',
  velocity: 'text-danger',
  reconnect: 'text-azure-1',
  conviction: 'text-warning'
};

export function NextBestActions({ actions }: { actions: NextAction[] }) {
  if (actions.length === 0) return null;

  return (
    <section className="mb-4 rounded-[14px] border border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
      <header className="flex items-center gap-2">
        <Target size={16} className="text-gold-1" aria-hidden />
        <h2 className="text-[13.5px] font-semibold text-fg-1">Next best actions</h2>
      </header>
      <p className="mt-1 text-[12.5px] text-fg-3">
        Your highest-leverage moves right now — fused from approvals, stalled deals, cooling
        relationships, and low-conviction deals.
      </p>

      <ol className="mt-3 space-y-1.5">
        {actions.map((x, i) => {
          const Icon = KIND_ICON[x.kind];
          return (
            <li key={x.id}>
              <Link
                href={x.href}
                className="flex items-center gap-3 rounded-[10px] border border-hairline bg-surface-1 px-3 py-2 transition hover:bg-surface-2"
              >
                <span className="w-4 flex-none text-[12px] font-bold tabular-nums text-fg-4">
                  {i + 1}
                </span>
                <Icon size={14} className={`flex-none ${KIND_TONE[x.kind]}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg-1">
                    {x.title}
                  </span>
                  {x.detail ? (
                    <span className="block truncate text-[11.5px] text-fg-4">{x.detail}</span>
                  ) : null}
                </span>
                <ArrowRight size={13} className="flex-none text-fg-4" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
