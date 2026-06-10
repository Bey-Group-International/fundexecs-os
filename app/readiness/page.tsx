import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { MEMBER_TYPE_LABELS } from '@/lib/member-types';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getMemberProfile } from '@/lib/queries/member-profile';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getDashboardData } from '@/lib/queries/dashboard';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';
import { ProfileRailSummary } from '@/components/profile';
import {
  loadReadinessHistory,
  captureReadinessSnapshot
} from '@/lib/queries/dashboard/readiness-history';
import {
  computeCompoundReadiness,
  computeReadinessValue,
  projectTrajectory,
  rankByValue
} from '@/lib/readiness';
import { ReadinessView } from '@/components/readiness/ReadinessView';

export const metadata: Metadata = {
  title: 'Readiness',
  description:
    'Compound institutional readiness — how your dimensions reinforce each other, the value they unlock, and the fastest path to 100%.'
};

export const dynamic = 'force-dynamic';

/**
 * Readiness — the dedicated compound-readiness surface.
 *
 * Where the Command Center shows readiness as one ring among many, this page is
 * the deep view: the compound score (synergy + balance bonus on top of the flat
 * weighted average), a persisted trend with a momentum read, a what-if panel
 * the operator can drag, and every dimension priced in dollars-unlocked so the
 * action list ranks by value, not gap size.
 *
 * The server resolves the live breakdown + raise target via the shared
 * `getDashboardData` loader, derives the compound model from the same pure
 * functions the client uses, persists today's snapshot (best-effort, for the
 * trend), then hands the lot to the client `<ReadinessView>`.
 */
export default async function ReadinessPage() {
  const identity = await getShellIdentity();
  if (!identity) redirect('/login?redirectedFrom=%2Freadiness');

  const [org, memberProfile] = await Promise.all([getActiveOrg(), getMemberProfile()]);
  const memberType = memberProfile?.memberType ?? null;
  const subtitle = memberType ? MEMBER_TYPE_LABELS[memberType] : 'Your workspace';

  if (!org) {
    return (
      <AppShell title="Readiness" subtitle={subtitle} identity={identity}>
        <Card className="p-8 text-center">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            No workspace yet
          </p>
          <p className="mt-2 text-[13px] text-fg-2">
            Your workspace is being set up. Refresh in a moment.
          </p>
        </Card>
      </AppShell>
    );
  }

  const [dashboard, wallet, fundProfile] = await Promise.all([
    getDashboardData(org.orgId),
    getCreditWallet(org.orgId),
    getFundProfile(org.orgId)
  ]);

  // Derive the compound model from the same pure engine the client uses, so the
  // server-rendered first paint and the interactive what-if never disagree.
  const compound = computeCompoundReadiness(dashboard.readinessBreakdown);
  const target = dashboard.raiseProgress.target;
  const value = computeReadinessValue(compound, target);
  const ranked = rankByValue(compound, value);
  // Forward projection of steady execution — the compounding curve over time.
  const trajectory = projectTrajectory(dashboard.readinessBreakdown, target);

  // Persist today's snapshot (idempotent per day) before reading the trend, so a
  // brand-new org sees at least its first point. Both are best-effort.
  await captureReadinessSnapshot(
    org.orgId,
    compound.compoundScore,
    compound.baseScore,
    dashboard.readinessBreakdown
  );
  const history = await loadReadinessHistory(org.orgId);

  const navSignals = buildRailSignals(dashboard, memberType);

  return (
    <AppShell
      title="Readiness"
      subtitle={subtitle}
      identity={identity}
      wallet={wallet}
      navSignals={navSignals}
      sourceOfTruthSummary={<ProfileRailSummary profile={fundProfile} />}
    >
      <ReadinessView
        breakdown={dashboard.readinessBreakdown}
        compound={compound}
        value={value}
        ranked={ranked}
        history={history}
        trajectory={trajectory}
        target={target}
        lockedByReadiness={dashboard.valueAtStake.lockedByReadiness}
      />
    </AppShell>
  );
}
