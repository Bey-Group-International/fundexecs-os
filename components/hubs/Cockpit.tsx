import Link from 'next/link';
import { Route } from 'lucide-react';
import { MandateIcon } from '@/components/ui/MandateIcon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { HUB_META, type HubId } from '@/lib/hubs/lifecycle';
import { cn } from '@/lib/utils';

/**
 * The lifecycle cockpit — the Command Center's reactive mirror of the rail.
 * Four stage cards with live readiness; the operator's center of gravity is
 * highlighted. Tap a stage to open its hub.
 */
export function Cockpit({ pct, center }: { pct: Record<HubId, number>; center: HubId }) {
  return (
    <section className="rounded-2xl border border-hairline bg-bg-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Route size={14} strokeWidth={1.9} className="text-fg-4" aria-hidden />
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          Your lifecycle
        </h2>
        <span className="text-[11px] text-fg-5">· tap a stage to open it</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {HUB_META.map((hub) => {
          const isCenter = center === hub.id;
          return (
            <Link
              key={hub.id}
              href={hub.href}
              className={cn(
                'rounded-xl border px-3 py-3 transition hover:bg-surface-2',
                isCenter
                  ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]'
                  : 'border-hairline bg-surface-1'
              )}
            >
              <div className="mb-2 flex items-center gap-2">
                <MandateIcon
                  name={hub.icon}
                  size={15}
                  strokeWidth={1.9}
                  className={isCenter ? 'text-accent' : 'text-fg-3'}
                  aria-hidden
                />
                <span className="flex-1 text-[13px] font-semibold">{hub.label}</span>
                {isCenter && (
                  <span
                    className="fx-glow-pulse h-1.5 w-1.5 rounded-full bg-gold-1"
                    title="Your focus right now"
                  />
                )}
                <span className="text-[11.5px] font-semibold text-fg-3 [font-feature-settings:'tnum']">
                  {pct[hub.id]}%
                </span>
              </div>
              <ProgressBar
                value={pct[hub.id]}
                height={4}
                tone={isCenter ? 'accent' : 'gold'}
                label={`${hub.label} readiness`}
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
