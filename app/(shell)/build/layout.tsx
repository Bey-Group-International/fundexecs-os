import { redirect } from 'next/navigation';
import { Blocks } from 'lucide-react';
import { BuildHubTabs } from '@/components/hubs/BuildHubTabs';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { FORMATION_ITEMS } from '@/lib/formation/config';
import { GOV_POLICIES } from '@/lib/governance/config';
import { MAT_DOCS } from '@/lib/dataroom/config';
import { getLifecycleRail } from '@/lib/hubs';
import { getDataRoomState } from '@/lib/queries/data-room';
import { getFormationState } from '@/lib/queries/formation';
import { getGovernanceHubState } from '@/lib/queries/governance-hub';
import { getActiveOrg } from '@/lib/queries/org';
import { cn } from '@/lib/utils';

/**
 * The Build hub shell — the prototype's BuildHub chrome around every module
 * route: hero with live readiness, the three stat tiles (formation filed /
 * materials ready / policies active, all real counts), the module tabs, and
 * Earn's standing note. The active module renders between tabs and note, so
 * /build/* reads as one tabbed surface while every tab keeps its deep link.
 */

const TONE_TEXT: Record<'success' | 'azure' | 'gold', string> = {
  success: 'text-success',
  azure: 'text-azure-1',
  gold: 'text-gold-1'
};

function StatTile({
  label,
  value,
  sub,
  tone
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'success' | 'azure' | 'gold';
}) {
  return (
    <div className="rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.08em] text-fg-5">{label}</div>
      <div className={cn('mt-0.5 text-[17px] font-semibold tabular-nums', TONE_TEXT[tone])}>
        {value}
      </div>
      <div className="text-[10.5px] text-fg-5">{sub}</div>
    </div>
  );
}

export default async function BuildHubLayout({ children }: { children: React.ReactNode }) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [formation, dataRoom, governance, rail] = await Promise.all([
    getFormationState(org.orgId),
    getDataRoomState(org.orgId),
    getGovernanceHubState(org.orgId),
    getLifecycleRail(org.orgId)
  ]);

  const filed = formation.completedIds.length;
  const ready = MAT_DOCS.filter((id) => dataRoom.stages[id] === 'Ready').length;
  const active = Object.keys(governance.adopted).length;
  const pct = rail.pct.build;

  return (
    <div className="fx-rise mx-auto flex max-w-[980px] flex-col gap-4">
      {/* hero — the prototype's Build header with live readiness + stats */}
      <section className="rounded-2xl border border-hairline bg-bg-1 px-5 py-[18px]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Blocks size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Build</h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Stand up your fund — formation, materials and governance, drafted by the team.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">{pct}%</div>
            <div className="text-[10.5px] text-fg-5">Build ready</div>
          </div>
        </div>
        <div className="mb-4 mt-3.5">
          <ProgressBar value={pct} height={6} tone="gold" label="Build readiness" />
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <StatTile
            label="Formation filed"
            value={`${filed}/${FORMATION_ITEMS.length}`}
            sub="legal & structure"
            tone="success"
          />
          <StatTile
            label="Materials ready"
            value={`${ready}/${MAT_DOCS.length}`}
            sub="deck, DDQ, model…"
            tone="azure"
          />
          <StatTile
            label="Policies active"
            value={`${active}/${GOV_POLICIES.length}`}
            sub="governance"
            tone="gold"
          />
        </div>
      </section>

      <BuildHubTabs />

      {children}

      {/* Earn's standing note — the prototype's closing strip */}
      <section className="flex items-center gap-3 rounded-2xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> I draft every document and filing to an
          institutional standard. Tap any item — I prepare it, you approve, it&rsquo;s done.
        </p>
      </section>
    </div>
  );
}
