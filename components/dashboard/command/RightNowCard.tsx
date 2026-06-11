import Link from 'next/link';
import { Sparkles, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import type { DashboardAction } from '@/lib/queries/dashboard';

/* ============================================================================
 * RightNowCard — "Right now · your highest-impact move".
 *
 * The prototype's gold hero: the single ranked move, an Earn note that frames
 * "I prepared this — you approve", the reward, and one primary CTA into the
 * surface that runs it. Fed by the real `nextBestAction`. Calm empty state.
 * ========================================================================= */

export interface RightNowCardProps {
  action: DashboardAction | null;
  /** Earn coins credited for completing the move. */
  reward: number;
  /** Optional control slot (e.g. the regenerate button), top-right. */
  control?: React.ReactNode;
  className?: string;
}

export function RightNowCard({ action, reward, control, className }: RightNowCardProps) {
  return (
    <Card
      data-testid="next-best-action-card"
      className={cn(
        'overflow-hidden border-[var(--gold-line)] p-0 shadow-[0_0_0_1px_var(--gold-line),var(--shadow-lg)]',
        className
      )}
    >
      <div className="flex items-center gap-3 border-b border-[var(--border-faint)] bg-[linear-gradient(100deg,rgba(247,201,72,0.13),transparent_60%)] px-5 py-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-gold-1">
          Right now · your highest-impact move
        </span>
        <span className="flex-1" />
        {action ? (
          <Badge tone={action.tone === 'warning' ? 'warning' : 'gold'} dot>
            {action.tone === 'warning' ? 'Time-sensitive' : 'Recommended'}
          </Badge>
        ) : (
          <Badge tone="success" dot>
            Clear
          </Badge>
        )}
        {control}
      </div>

      {!action ? (
        <div className="px-5 py-6">
          <p className="text-[13px] text-fg-3">
            Your desk is in order — Earn will surface the next move the moment one&rsquo;s ready.
          </p>
        </div>
      ) : (
        <div className="px-[22px] py-5" data-testid={`next-best-action-${action.id}`}>
          <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-fg-1">
            {action.title}
          </h2>
          <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-fg-3">
            {action.context}
          </p>

          <div className="mt-[18px] flex flex-wrap items-center gap-3">
            <Link
              href={action.href}
              data-testid="next-best-action-cta"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-gold-1 to-gold-2 px-4 py-2.5 text-[13px] font-semibold text-[#070b14] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              <Sparkles size={15} strokeWidth={1.9} aria-hidden />
              {action.cta}
            </Link>
            <Link
              href={action.href}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline px-3.5 py-2.5 text-[13px] font-medium text-fg-2 transition hover:bg-surface-2"
            >
              Open details
              <ArrowUpRight size={14} strokeWidth={1.9} aria-hidden />
            </Link>
            {reward > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gold-1">
                <ArrowRight size={11} aria-hidden />+{reward} coins on completion
              </span>
            )}
          </div>

          <div className="mt-[18px] flex items-start gap-3 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-[15px] py-[13px]">
            <EarnCoin size={26} className="flex-none" />
            <p className="text-[12.5px] leading-relaxed text-fg-2">
              <span className="font-semibold text-gold-1">Earn:</span> I prepared this and can take
              it end to end — you just review and approve. Nothing leaves FundExecs OS until you
              confirm.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
