import { MoonStar, ArrowRight, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui';
import type { SinceLastVisit } from '@/lib/queries/dashboard';

/* ============================================================================
 * SignalStrip — "Your team worked overnight".
 *
 * The prototype's proactive surface: what the desk did since you last looked,
 * as tappable signals. Fed by the real `sinceLastVisit` continuity summary.
 * Renders nothing on the very first visit (there's no "since" yet) or when the
 * desk has been quiet — keeping the home calm rather than padded.
 * ========================================================================= */

export interface SignalStripProps {
  since: SinceLastVisit;
}

export function SignalStrip({ since }: SignalStripProps) {
  const highlights = since.highlights ?? [];
  if (since.isFirstVisit || highlights.length === 0) return null;

  return (
    <Card className="p-[18px]">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          <MoonStar size={16} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Proactive — since you last looked
          </div>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
            Your team worked overnight
          </div>
        </div>
        {since.newActivityCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-gold-1">
            <Sparkles size={11} aria-hidden />
            {since.newActivityCount} new
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {highlights.map((line, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-[12px] border border-hairline bg-surface-1 px-[13px] py-3"
          >
            <span className="mt-0.5 flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
              <Sparkles size={13} strokeWidth={1.9} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium leading-snug text-fg-1">{line}</p>
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-fg-4">
                <ArrowRight size={11} aria-hidden />
                Logged to your Chain of Trust
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
