import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getMemberProfile } from '@/lib/queries/member-profile';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';
import { loadBuildWorkspace } from '@/lib/build';
import { ProfileRailSummary } from '@/components/profile';
import { BuildHubView } from '@/components/build/BuildHubView';

export const metadata: Metadata = {
  title: 'Build',
  description:
    'The Build hub — record strength, the loop handoff, and the four record panels (Profile, Strategy, Readiness, Chain of Trust) on one surface.'
};

export const dynamic = 'force-dynamic';

/**
 * `/build` — the Build verb's hub (first of the four verb hubs).
 *
 * Where the rail's Build cluster lists four routes, this surface owns the verb:
 * the headline record strength, Build's place in the loop chain, Earn's next
 * best action, and live panel summaries deep-linking into each subsection.
 * All numbers come from `loadBuildWorkspace`, which composes the shared
 * dashboard loader — the hub, the rail badges, and the Command Center can
 * never disagree.
 */
export default async function BuildPage() {
  const identity = await getShellIdentity();
  if (!identity) redirect('/login?redirectedFrom=%2Fbuild');

  const org = await getActiveOrg();
  if (!org) {
    return (
      <AppShell title="Build" subtitle="Establish the record" identity={identity}>
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

  const [workspace, memberProfile, wallet, fundProfile] = await Promise.all([
    loadBuildWorkspace(org.orgId).catch((err) => {
      console.error('[BuildPage] Failed to load build workspace:', err);
      return null;
    }),
    getMemberProfile().catch(() => null),
    getCreditWallet(org.orgId).catch(() => null),
    getFundProfile(org.orgId).catch(() => null)
  ]);

  if (!workspace) {
    return (
      <AppShell title="Build" subtitle="Establish the record" identity={identity} wallet={wallet}>
        <Card className="p-8 text-center">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            Build hub unavailable
          </p>
          <p className="mt-2 text-[13px] text-fg-2">
            We couldn&apos;t load your record right now. Refresh in a moment.
          </p>
        </Card>
      </AppShell>
    );
  }

  const navSignals = buildRailSignals(workspace.dashboard, memberProfile?.memberType ?? null);

  return (
    <AppShell
      title="Build"
      subtitle="Establish the record"
      identity={identity}
      wallet={wallet}
      navSignals={navSignals}
      sourceOfTruthSummary={fundProfile ? <ProfileRailSummary profile={fundProfile} /> : undefined}
    >
      <BuildHubView workspace={workspace} />
    </AppShell>
  );
}
