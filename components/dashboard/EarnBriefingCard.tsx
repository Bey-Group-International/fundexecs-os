import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { getCOO } from '@/lib/team/roster';
import { gradientForSlug } from '@/lib/team/avatar';
import type { EarnBriefing } from '@/lib/queries/dashboard';

export interface EarnBriefingCardProps {
  briefing: EarnBriefing;
  className?: string;
}

/**
 * EarnBriefingCard — Earn's synthesized daily briefing, voiced by the COO. The
 * gold disc marks it as Earn (the only gold member of the desk). Lines are
 * derived deterministically in the loader today (`buildBriefing`); the seam to
 * an Opus synthesis pass is documented there.
 */
export function EarnBriefingCard({ briefing, className }: EarnBriefingCardProps) {
  if (!briefing.lines.length) return null;
  const earn = getCOO();
  const g = gradientForSlug(earn.slug);

  return (
    <Card
      className={cn('fx-rise relative overflow-hidden p-5', className)}
      data-testid="earn-briefing-card"
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-[14px] font-bold text-white shadow-[var(--shadow-sm)]"
          style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
        >
          EF
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gold-1">
              {earn.name} · {earn.position}
            </p>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" aria-hidden />
              Live
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-4">
            Today&rsquo;s briefing
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {briefing.lines.map((line, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-fg-2">
                <span aria-hidden className="mt-1.5 h-1 w-1 flex-none rounded-full bg-gold-1" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

export default EarnBriefingCard;
