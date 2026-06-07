import { Sparkles, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SinceLastVisit } from '@/lib/queries/dashboard';

export interface SinceAwayBannerProps {
  since: SinceLastVisit;
  className?: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * SinceAwayBanner — the compounding-continuity hook. On a return visit with new
 * desk activity it summarizes what changed while the operator was away (count +
 * up-to-3 highlights). On the first ever visit it renders a calm welcome. When
 * nothing changed it renders nothing, so the canvas never carries dead chrome.
 */
export function SinceAwayBanner({ since, className }: SinceAwayBannerProps) {
  if (since.isFirstVisit) {
    return (
      <div
        data-testid="since-away-banner"
        data-variant="welcome"
        className={cn(
          'fx-rise flex items-center gap-3 rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3',
          className
        )}
      >
        <Sparkles size={16} strokeWidth={2} className="flex-none text-gold-1" aria-hidden />
        <p className="text-[12.5px] text-fg-2">
          <span className="font-semibold text-fg-1">Welcome to your command center.</span> Earn and
          the desk start compounding from here — every move on the record.
        </p>
      </div>
    );
  }

  if (since.newActivityCount <= 0) return null;

  return (
    <div
      data-testid="since-away-banner"
      data-variant="returning"
      className={cn(
        'fx-rise rounded-2xl border border-[var(--azure-line)] bg-[var(--azure-soft)] px-4 py-3',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <History size={16} strokeWidth={2} className="flex-none text-azure-1" aria-hidden />
        <p className="text-[12.5px] text-fg-2">
          <span className="font-semibold text-fg-1">Since you were away</span>
          {since.lastVisitISO ? (
            <span className="text-fg-4"> · {relativeTime(since.lastVisitISO)}</span>
          ) : null}{' '}
          — the desk logged{' '}
          <span className="font-semibold text-azure-1">
            {since.newActivityCount} update{since.newActivityCount === 1 ? '' : 's'}
          </span>
          .
        </p>
      </div>
      {since.highlights.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5 pl-7">
          {since.highlights.map((h, i) => (
            <li
              key={i}
              className="rounded-full border border-hairline bg-bg-1 px-2.5 py-0.5 text-[11px] text-fg-3"
            >
              {h}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default SinceAwayBanner;
