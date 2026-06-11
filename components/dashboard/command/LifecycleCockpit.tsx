import Link from 'next/link';
import { Hammer, Radar, Cog, Rocket, Route, type LucideIcon } from 'lucide-react';
import { Card, ProgressBar } from '@/components/ui';
import { cn } from '@/lib/utils';
import { deriveCockpit, type HubKey } from '@/lib/dashboard/cockpit';
import type { LifecycleStage, ReadinessDimensionScore } from '@/lib/lifecycle';

/* ============================================================================
 * LifecycleCockpit — the prototype's daily home leads with the loop as a grid.
 *
 * The four verbs (Build · Source · Run · Drive) as tappable cards, each with a
 * readiness % from the real readiness breakdown, the current stage's verb
 * marked "NOW". Tapping a card opens that hub — the cockpit mirrors the rail.
 * ========================================================================= */

const HUB_ICON: Record<HubKey, LucideIcon> = {
  build: Hammer,
  source: Radar,
  run: Cog,
  drive: Rocket
};

export interface LifecycleCockpitProps {
  readinessBreakdown: ReadinessDimensionScore[];
  stage: LifecycleStage;
}

export function LifecycleCockpit({ readinessBreakdown, stage }: LifecycleCockpitProps) {
  const hubs = deriveCockpit({ readinessBreakdown, stage });

  return (
    <Card className="p-[17px]">
      <div className="mb-3 flex items-center gap-2">
        <Route size={14} className="text-fg-4" aria-hidden />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          Your lifecycle
        </span>
        <span className="text-[11px] text-fg-5">· tap a stage to open it</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {hubs.map((h) => {
          const Icon = HUB_ICON[h.key];
          return (
            <Link
              key={h.key}
              href={h.href}
              className={cn(
                'group rounded-[13px] border px-3.5 py-3 transition',
                h.isCurrent
                  ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]'
                  : 'border-hairline bg-surface-1 hover:bg-surface-2'
              )}
            >
              <div className="mb-2.5 flex items-center gap-2">
                <Icon
                  size={15}
                  strokeWidth={1.9}
                  className={h.isCurrent ? 'text-[var(--accent)]' : 'text-fg-3'}
                  aria-hidden
                />
                <span className="flex-1 text-[13px] font-semibold text-fg-1">{h.label}</span>
                {h.isCurrent && (
                  <span className="inline-flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-[0.08em] text-gold-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-gold-1 motion-safe:animate-pulse"
                      aria-hidden
                    />
                    Now
                  </span>
                )}
                <span className="text-[11.5px] font-semibold tabular-nums text-fg-3">{h.pct}%</span>
              </div>
              <ProgressBar
                value={h.pct}
                height={4}
                color={h.isCurrent ? 'var(--accent)' : 'var(--gold-1)'}
                ariaLabel={`${h.label} readiness`}
              />
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
