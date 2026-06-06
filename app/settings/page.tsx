import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getMemberProfile } from '@/lib/queries/member-profile';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { getDashboardData } from '@/lib/queries/dashboard';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';
import { FundProfileRailSummary } from '@/components/fund-profile';
import type { Database } from '@/lib/supabase/database.types';
import { SettingsView } from './SettingsView';

export const metadata: Metadata = { title: 'Profile & settings' };

type OrgType = Database['public']['Enums']['org_type'];

/**
 * Profile & settings — gamification header plus account / trust / notifications /
 * security / organization / billing sections rendered as a vertical detail rail.
 * The signed-in email and active org are resolved on the server; everything else
 * is presentational. Wallet + rail-signals + Source-of-Truth summary keep the
 * shell lifecycle-aware on this surface.
 */
export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const identity = await getShellIdentity();
  const [org, memberProfile] = await Promise.all([getActiveOrg(), getMemberProfile()]);

  let orgName: string | null = null;
  let orgTier: string | null = null;
  let orgType: OrgType | null = null;
  if (org) {
    const { data } = await supabase
      .from('organizations')
      .select('name, tier, type')
      .eq('id', org.orgId)
      .maybeSingle();
    orgName = data?.name ?? null;
    orgTier = data?.tier ?? null;
    orgType = data?.type ?? null;
  }

  let fullName: string | null = null;
  let role: string | null = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, role')
      .eq('id', user.id)
      .maybeSingle();
    fullName = data?.full_name ?? null;
    role = data?.role ?? null;
  }

  const [wallet, fundProfile, dashboard] = org
    ? await Promise.all([
        getCreditWallet(org.orgId).catch(() => null),
        getFundProfile(org.orgId).catch(() => null),
        getDashboardData(org.orgId).catch(() => null)
      ])
    : [null, null, null];
  const navSignals = dashboard ? buildRailSignals(dashboard) : undefined;
  const sourceOfTruthSummary = fundProfile ? (
    <FundProfileRailSummary profile={fundProfile} />
  ) : undefined;

  return (
    <AppShell
      identity={identity}
      wallet={wallet}
      navSignals={navSignals}
      sourceOfTruthSummary={sourceOfTruthSummary}
      title="Profile & settings"
      subtitle="Your account, organization, and trust profile"
    >
      <SettingsView
        email={user?.email ?? null}
        fullName={fullName}
        role={role}
        orgName={orgName}
        orgTier={orgTier}
        orgType={orgType}
        bio={memberProfile?.bio ?? null}
        phone={
          typeof memberProfile?.details.contact_phone === 'string'
            ? memberProfile.details.contact_phone
            : null
        }
        proofStatus={memberProfile?.status ?? 'in_progress'}
        proofPct={memberProfile?.completionPct ?? 0}
        proofMemberType={memberProfile?.memberType ?? null}
      />
    </AppShell>
  );
}
