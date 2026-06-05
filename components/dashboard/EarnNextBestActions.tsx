import Link from 'next/link';
import { ArrowUpRight, Sparkles, type LucideIcon } from 'lucide-react';
import { Card, SectionTitle } from '@/components/ui';
import { TeamAvatar, getCOO } from '@/lib/team';
import { cn } from '@/lib/utils';

export interface NextBestAction {
  /** Stable id (used for the React key + emitTrust eventing later). */
  id: string;
  /** Action title (verbal, present tense). */
  title: string;
  /** One-line context shown under the title. */
  context: string;
  /** Primary CTA label. */
  cta: string;
  /** Internal route the CTA links to. */
  href: string;
  /** Optional Lucide icon. */
  icon?: LucideIcon;
  /** Visual tone — reserves gold for Earn/XP signals only. */
  tone?: 'azure' | 'gold' | 'success' | 'warning';
}

const TONE: Record<
  NonNullable<NextBestAction['tone']>,
  { border: string; bg: string; text: string }
> = {
  azure: {
    border: 'border-[var(--azure-line)]',
    bg: 'bg-[var(--azure-soft)]',
    text: 'text-azure-1'
  },
  gold: { border: 'border-[var(--gold-line)]', bg: 'bg-[var(--gold-soft)]', text: 'text-gold-1' },
  success: {
    border: 'border-[var(--success-line)]',
    bg: 'bg-[var(--success-soft)]',
    text: 'text-success'
  },
  warning: {
    border: 'border-[var(--warning-line)]',
    bg: 'bg-[var(--warning-soft)]',
    text: 'text-warning'
  }
};

/**
 * EarnNextBestActions — rail of 3–5 heuristic action cards seeded from data
 * the layout already loaded. Pure navigation in Phase 2; the actions route to
 * existing screens. Phase 4 wires server actions through the same cards.
 *
 * Mobile: rail becomes a horizontally-scrollable strip that respects the
 * global `body { overflow-x: clip }` rule.
 */
export function EarnNextBestActions({ actions }: { actions: NextBestAction[] }) {
  const earn = getCOO();

  if (!actions || actions.length === 0) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <TeamAvatar member={earn} size={36} className="flex-none" />
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-gold-1">
              Earn’s next best
            </p>
            <p className="mt-1 text-[13px] text-fg-2">
              I’ll surface next steps here as your data grows. Open{' '}
              <Link
                href="/ask-earn"
                className="font-semibold text-gold-1 underline-offset-2 hover:underline"
              >
                Ask Earn
              </Link>{' '}
              to start a workflow now.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <SectionTitle
        eyebrow={`Earn · ${earn.position}`}
        title="Next best actions"
        className="mb-3"
      />
      <ul
        className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-col sm:px-0 sm:pb-0"
        // The overflow rule lets the rail scroll on mobile, while desktop
        // stacks. `overscroll-behavior-x: contain` keeps the page from
        // capturing the swipe.
        style={{ scrollbarWidth: 'thin', overscrollBehaviorX: 'contain' }}
      >
        {actions.map((a) => {
          const Icon = a.icon ?? Sparkles;
          const tone = TONE[a.tone ?? 'azure'];
          return (
            <li key={a.id} className="min-w-[260px] flex-none sm:min-w-0">
              <Link
                href={a.href}
                className="group flex h-full items-start gap-3 rounded-xl border border-hairline bg-surface-1 p-3 transition hover:bg-surface-2"
              >
                <span
                  className={cn(
                    'flex h-9 w-9 flex-none items-center justify-center rounded-lg border',
                    tone.border,
                    tone.bg,
                    tone.text
                  )}
                >
                  <Icon size={15} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-fg-1">{a.title}</p>
                  <p className="mt-0.5 text-[11.5px] leading-5 text-fg-4">{a.context}</p>
                  <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-azure-1 group-hover:underline">
                    {a.cta}
                    <ArrowUpRight size={11} strokeWidth={2} aria-hidden />
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
