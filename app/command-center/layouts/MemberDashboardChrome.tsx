import type { ReactNode } from 'react';
import { Card } from '@/components/ui';
import {
  ChainOfTrustStrip,
  type ChainOfTrustStanding
} from '@/components/dashboard/ChainOfTrustStrip';
import {
  EarnNextBestActions,
  type NextBestAction
} from '@/components/dashboard/EarnNextBestActions';
import { TeamAvatar, getCOO } from '@/lib/team';

export interface MemberDashboardChromeProps {
  displayName: string;
  position: string;
  trust: ChainOfTrustStanding;
  /** 3–5 heuristic actions surfaced in the right-rail (or below on mobile). */
  actions: NextBestAction[];
  /** Layout-specific body (KPI tiles + list cards). */
  children: ReactNode;
}

/**
 * MemberDashboardChrome — shared frame for every member-type dashboard.
 * Renders:
 *   - hero strip with the member's display name + position + COO greeting,
 *   - the 4-segment Chain-of-Trust standing,
 *   - the per-type body (passed as children),
 *   - the Earn next-best-actions rail (right-rail on lg+, stacked on mobile).
 */
export function MemberDashboardChrome({
  displayName,
  position,
  trust,
  actions,
  children
}: MemberDashboardChromeProps) {
  const coo = getCOO();
  return (
    <div className="flex flex-col gap-[18px]">
      <Card className="relative overflow-hidden p-[18px]">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: 'radial-gradient(70% 130% at 0% 0%, rgba(247,201,72,0.08), transparent 60%)'
          }}
          aria-hidden
        />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <TeamAvatar member={coo} size={48} glow online className="flex-none" />
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gold-1">
              {coo.position} · your live AI guide
            </p>
            <h1 className="mt-0.5 text-[20px] font-semibold tracking-[-0.015em] text-fg-1 sm:text-[22px]">
              Good to see you, {displayName.split(' ')[0]}.
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">{position} · your workspace</p>
          </div>
        </div>
        <div className="mt-4">
          <ChainOfTrustStrip standing={trust} />
        </div>
      </Card>

      <div className="grid items-start gap-[18px] lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">{children}</div>
        <div className="min-w-0">
          <EarnNextBestActions actions={actions} />
        </div>
      </div>
    </div>
  );
}
