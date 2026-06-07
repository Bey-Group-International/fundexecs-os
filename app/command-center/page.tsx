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
import { LifecycleDashboard } from '@/components/dashboard/LifecycleDashboard';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';
import { FundProfileRailSummary } from '@/components/fund-profile';

export const metadata: Metadata = {
  title: 'Command Center'
};

export const dynamic = 'force-dynamic';

/**
 * Command Center — the single, lifecycle-aware Dashboard canvas.
 *
 * Wave-1 replaces the five stacked per-member-type layouts with one
 * `<LifecycleDashboard>` that consumes Claude's `getDashboardData(orgId)`
 * loader. Member-type variants live INSIDE the dashboard (copy + section
 * ordering); the underlying payload is the same for every operator.
 *
 * Bootstrap order (server):
 *   1. identity + active org + member profile (cheap; gate the page)
 *   2. dashboard + wallet in parallel (heavier; both needed by the chrome)
 *   3. derive rail signals from the dashboard for live nav badges
 *   4. render <AppShell> with the wallet + signals, mount <LifecycleDashboard>
 *
 * The five legacy per-member layouts were retired with the single-canvas
 * migration; their member-type variation now lives inside <LifecycleDashboard>.
 */
export default async function CommandCenterPage() {
  const identity = await getShellIdentity();
  if (!identity) redirect('/login?redirectedFrom=%2Fcommand-center');

  const [org, memberProfile] = await Promise.all([getActiveOrg(), getMemberProfile()]);
  const memberType = memberProfile?.memberType ?? null;
  const subtitle = memberType ? MEMBER_TYPE_LABELS[memberType] : 'Your workspace';
  const displayName = memberProfile?.displayName ?? identity.name ?? 'Welcome';

  if (!org) {
    return (
      <AppShell title="Command Center" subtitle={subtitle} identity={identity}>
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

  if (!memberType) {
    return (
      <AppShell title="Command Center" subtitle={subtitle} identity={identity}>
        <Card className="p-8 text-center">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gold-1">
            One step to go
          </p>
          <p className="mt-2 text-[13.5px] text-fg-1">
            Complete your Proof of Truth so Earn can tune your desk.
          </p>
          <p className="mt-1 text-[11.5px] text-fg-4">
            We&rsquo;ll pick the right dashboard variant once we know your member type.
          </p>
          <a
            href="/onboarding"
            className="mt-4 inline-flex text-[12px] font-semibold text-azure-1 hover:underline"
          >
            Open onboarding →
          </a>
        </Card>
      </AppShell>
    );
  }

  const [dashboard, wallet, fundProfile] = await Promise.all([
    getDashboardData(org.orgId),
    getCreditWallet(org.orgId),
    getFundProfile(org.orgId)
  ]);
  const navSignals = buildRailSignals(dashboard);

  return (
    <AppShell
      title="Command Center"
      subtitle={subtitle}
      identity={identity}
      wallet={wallet}
      navSignals={navSignals}
      sourceOfTruthSummary={<FundProfileRailSummary profile={fundProfile} />}
    >
      <LifecycleDashboard displayName={displayName} memberType={memberType} data={dashboard} />
    </AppShell>
  );
}
