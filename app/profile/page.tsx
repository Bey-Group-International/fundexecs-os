import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getDashboardData } from '@/lib/queries/dashboard';
import { getProfile } from '@/lib/queries/fund-profile';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';
import {
  ProfileHero,
  ProfileLadder,
  ProfileSections,
  ProfileGapsCard,
  ProfileRailSummary
} from '@/components/profile';

export const metadata: Metadata = {
  title: 'Profile'
};

export const dynamic = 'force-dynamic';

/**
 * Profile — the Source-of-Truth surface.
 *
 * Reads the member-type-aware `Profile` payload from `getProfile(orgId)` and
 * composes:
 *   - ProfileHero        — entity name · owner · completeness ring
 *   - ProfileGapsCard    — fields a counterparty would press on (Earn closes each)
 *   - ProfileSections    — the member's schema-driven fields, read-mostly
 *
 * Sections, completeness, and gaps are derived from the same per-member-type
 * question set onboarding uses, so the surface adapts to who the member is and
 * every gap is closeable in onboarding. Edits flow through `/onboarding`.
 *
 * Rail signals + wallet are resolved alongside the profile fetch so the shell
 * stays lifecycle-aware. All loaders here are cached per-request by Next.
 */
export default async function ProfilePage() {
  const identity = await getShellIdentity();
  if (!identity) redirect('/login?redirectedFrom=%2Fprofile');

  const org = await getActiveOrg();
  if (!org) {
    return (
      <AppShell title="Profile" subtitle="Source of Truth" identity={identity}>
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
    getProfile(org.orgId),
    getCreditWallet(org.orgId).catch(() => null),
    getDashboardData(org.orgId).catch(() => null)
  ]);
  const navSignals = dashboard
    ? buildRailSignals(dashboard, profile?.memberType ?? null)
    : undefined;

  return (
    <AppShell
      title="Profile"
      subtitle="Source of Truth · on the record"
      identity={identity}
      wallet={wallet}
      navSignals={navSignals}
      sourceOfTruthSummary={<ProfileRailSummary profile={profile} />}
    >
      <div className="flex flex-col gap-[18px]" data-testid="profile-page">
        <ProfileHero profile={profile} />
        <ProfileLadder ladder={profile.ladder} />
        <ProfileGapsCard profile={profile} />
        <ProfileSections profile={profile} />
      </div>
    </AppShell>
  );
}
