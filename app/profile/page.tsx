import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getDashboardData } from '@/lib/queries/dashboard';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';
import {
  FundProfileHero,
  FundProfileSections,
  FundProfileGapsCard,
  FundProfileRailSummary
} from '@/components/fund-profile';

export const metadata: Metadata = {
  title: 'Fund Profile'
};

export const dynamic = 'force-dynamic';

/**
 * Fund Profile — the Source-of-Truth surface.
 *
 * Reads the canonical `FundProfile` payload from `getFundProfile(orgId)` and
 * composes four sub-components:
 *   - FundProfileHero        — fund name · manager · completeness ring
 *   - FundProfileGapsCard    — LP-probe list (Earn closes each)
 *   - FundProfileSections    — six LP-probed fields rendered read-mostly
 *
 * Edits flow through the existing onboarding/quiz route (`/onboarding`) —
 * Wave-1 is read-mostly here; the actions surface lands later.
 *
 * Rail signals + wallet are resolved alongside the profile fetch so the
 * shell stays lifecycle-aware even on this surface. All loaders here are
 * cached per-request by Next, so the parallel `getDashboardData` call
 * shares its result with the side rail's signal builder.
 */
export default async function FundProfilePage() {
  const identity = await getShellIdentity();
  if (!identity) redirect('/login?redirectedFrom=%2Fprofile');

  const org = await getActiveOrg();
  if (!org) {
    return (
      <AppShell title="Fund Profile" subtitle="Source of Truth" identity={identity}>
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

  const [profile, wallet, dashboard] = await Promise.all([
    getFundProfile(org.orgId),
    getCreditWallet(org.orgId).catch(() => null),
    getDashboardData(org.orgId).catch(() => null)
  ]);
  const navSignals = dashboard ? buildRailSignals(dashboard) : undefined;

  return (
    <AppShell
      title="Fund Profile"
      subtitle="Source of Truth · on the record"
      identity={identity}
      wallet={wallet}
      navSignals={navSignals}
      sourceOfTruthSummary={<FundProfileRailSummary profile={profile} />}
    >
      <div className="flex flex-col gap-[18px]" data-testid="fund-profile-page">
        <FundProfileHero profile={profile} />
        <FundProfileGapsCard profile={profile} />
        <FundProfileSections profile={profile} />
      </div>
    </AppShell>
  );
}
