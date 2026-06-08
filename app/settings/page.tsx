import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getMemberProfile } from '@/lib/queries/member-profile';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getOrgSubscription, type OrgSubscription } from '@/lib/queries/subscription';
import { getOrgTeam, type OrgTeam } from '@/lib/queries/org-members';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { getDashboardData } from '@/lib/queries/dashboard';
import { getAdminData, type AdminData } from '@/lib/queries/admin';
import { getAdminMetrics, type AdminMetrics } from '@/lib/queries/admin-metrics';
import { getBetaInvites, type BetaInvite } from '@/lib/queries/beta-invites';
import { getBetaLinks, type BetaLinkWithStatus } from '@/lib/queries/beta-links';
import { getBetaApplications, type BetaApplication } from '@/lib/queries/beta-applications';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';
import { isPlatformAdmin } from '@/lib/access';
import { ProfileRailSummary } from '@/components/profile';
import type { Database } from '@/lib/supabase/database.types';
import { SettingsView } from './SettingsView';

export const metadata: Metadata = { title: 'Profile & settings' };

type OrgType = Database['public']['Enums']['org_type'];
type OrgMemberRole = Database['public']['Enums']['org_member_role'];

const EMPTY_TEAM: OrgTeam = { members: [], invites: [], viewerRole: null };

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
  let orgDescription: string | null = null;
  let orgWebsite: string | null = null;
  let orgLogoUrl: string | null = null;
  if (org) {
    const { data } = await supabase
      .from('organizations')
      .select('name, tier, type, description, website, logo_url')
      .eq('id', org.orgId)
      .maybeSingle();
    orgName = data?.name ?? null;
    orgTier = data?.tier ?? null;
    orgType = data?.type ?? null;
    orgDescription = data?.description ?? null;
    orgWebsite = data?.website ?? null;
    orgLogoUrl = data?.logo_url ?? null;
  }

  const orgTeam =
    org && user ? await getOrgTeam(org.orgId, user.id).catch(() => EMPTY_TEAM) : EMPTY_TEAM;

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

  const [wallet, fundProfile, dashboard, subscription] = org
    ? await Promise.all([
        getCreditWallet(org.orgId).catch(() => null),
        getFundProfile(org.orgId).catch(() => null),
        getDashboardData(org.orgId).catch(() => null),
        getOrgSubscription(org.orgId).catch(() => null)
      ])
    : [null, null, null, null];

  const subscriptionView: OrgSubscription = subscription ?? {
    plan: 'free',
    interval: 'month',
    seats: 1,
    status: 'active',
    creditsPerPeriod: 0,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    configured: false
  };
  // Admin section — reserved for the Bey Group team (@beygroupintl.com), not
  // org role. A normal operator who owns their own workspace is not an admin.
  let isAdmin = false;
  let adminData: AdminData | null = null;
  let invites: BetaInvite[] = [];
  let betaLinks: BetaLinkWithStatus[] = [];
  let applications: BetaApplication[] = [];
  let adminMetrics: AdminMetrics | null = null;
  let viewerRole: OrgMemberRole | null = null;
  if (org && user && isPlatformAdmin(user.email)) {
    const ad = await getAdminData(org.orgId).catch(() => null);
    const me = ad?.members.find((m) => m.userId === user.id);
    viewerRole = me?.role ?? null;
    isAdmin = true;
    if (ad) {
      adminData = ad;
      [invites, adminMetrics, betaLinks, applications] = await Promise.all([
        getBetaInvites(org.orgId).catch(() => []),
        getAdminMetrics(org.orgId).catch(() => null),
        getBetaLinks(org.orgId).catch(() => []),
        getBetaApplications(org.orgId).catch(() => [])
      ]);
    }
  }

  const navSignals = dashboard
    ? buildRailSignals(dashboard, memberProfile?.memberType ?? null)
    : undefined;
  const sourceOfTruthSummary = fundProfile ? (
    <ProfileRailSummary profile={fundProfile} />
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
        orgDescription={orgDescription}
        orgWebsite={orgWebsite}
        orgLogoUrl={orgLogoUrl}
        orgTeam={orgTeam}
        currentUserId={user?.id ?? ''}
        bio={memberProfile?.bio ?? null}
        phone={
          typeof memberProfile?.details.contact_phone === 'string'
            ? memberProfile.details.contact_phone
            : null
        }
        avatarUrl={identity?.avatarUrl ?? null}
        proofStatus={memberProfile?.status ?? 'in_progress'}
        proofPct={memberProfile?.completionPct ?? 0}
        proofMemberType={memberProfile?.memberType ?? null}
        level={identity?.level ?? 1}
        xp={identity?.xp ?? 0}
        isAdmin={isAdmin}
        adminData={adminData}
        invites={invites}
        betaLinks={betaLinks}
        applications={applications}
        adminMetrics={adminMetrics}
        viewerRole={viewerRole}
        subscription={subscriptionView}
        creditBalance={wallet?.balance ?? 0}
      />
    </AppShell>
  );
}
