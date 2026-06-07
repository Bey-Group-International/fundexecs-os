import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui';
import {
  ChainOfTrustStrip,
  type ChainOfTrustStanding
} from '@/components/dashboard/ChainOfTrustStrip';
import {
  EarnNextBestActions,
  type NextBestAction
} from '@/components/dashboard/EarnNextBestActions';
import { TrustDrawerHost } from '@/components/shell/trust/TrustDrawerHost';
import { TeamAvatar, getCOO } from '@/lib/team';

/** Ordered lifecycle layers — each proof is a step toward completion. */
const LIFECYCLE: {
  key: keyof Pick<ChainOfTrustStanding, 'truth' | 'concept' | 'execution' | 'work'>;
  proof: string;
}[] = [
  { key: 'truth', proof: 'Truth' },
  { key: 'concept', proof: 'Concept' },
  { key: 'execution', proof: 'Execution' },
  { key: 'work', proof: 'Work' }
];

/**
 * Earn's self-aware coaching line for the hero — derived purely from the trust
 * standing the layout already loaded. Earn names exactly where the member sits
 * in the private-market lifecycle and the single next step that grows it.
 */
function earnCoachingLine(trust: ChainOfTrustStanding): string {
  if (!trust.hasRecord) {
    return 'Let’s lay your first proof — Proof of Truth sets the foundation for everything else.';
  }
  const next = LIFECYCLE.find((l) => trust[l.key] < 100);
  if (!next) {
    return 'Full institutional trust — your lifecycle proof is complete. I’ll keep it warm.';
  }
  const pct = Math.max(0, Math.min(100, Math.round(trust[next.key])));
  return `You’re ${pct}% through Proof of ${next.proof} — clearing it is your next step in the lifecycle.`;
}

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
 *   - the 4-segment Chain-of-Trust standing (clickable — opens drawer),
 *   - the per-type body (passed as children),
 *   - the Earn next-best-actions rail (right-rail on lg+, stacked on mobile).
 *
 * Wraps the entire frame in `<TrustDrawerHost />` so the CoT strip, deal-row
 * Trust chips, and any future call sites share a single drawer instance via
 * imperative `useTrustDrawer()` context.
 */
export function MemberDashboardChrome({
  displayName,
  position,
  trust,
  actions,
  children
}: MemberDashboardChromeProps) {
  const coo = getCOO();
  const coachingLine = earnCoachingLine(trust);
  return (
    <TrustDrawerHost>
      <div className="flex flex-col gap-[18px]">
        <Card className="relative overflow-hidden p-[18px]">
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(70% 130% at 0% 0%, rgba(247,201,72,0.08), transparent 60%)'
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
              <p className="mt-2 inline-flex items-start gap-1.5 text-[12px] leading-5 text-fg-2">
                <Sparkles
                  size={13}
                  strokeWidth={1.9}
                  className="mt-[3px] flex-none text-gold-1"
                  aria-hidden
                />
                <span>{coachingLine}</span>
              </p>
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
    </TrustDrawerHost>
  );
}
