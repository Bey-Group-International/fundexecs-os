import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { MEMBER_TYPE_LABELS } from '@/lib/member-types';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getMemberProfile } from '@/lib/queries/member-profile';
import {
  getDashboardCommon,
  getDashboardContext,
  getIndividualInvestorDashboardData,
  getInvestmentFirmDashboardData,
  getServiceProviderDashboardData,
  getStartupDashboardData,
  getStudentDashboardData
} from '@/lib/queries/dashboard';
import { InvestmentFirmLayout } from './layouts/InvestmentFirmLayout';
import { ServiceProviderLayout } from './layouts/ServiceProviderLayout';
import { StartupLayout } from './layouts/StartupLayout';
import { StudentLayout } from './layouts/StudentLayout';
import { IndividualInvestorLayout } from './layouts/IndividualInvestorLayout';

export const metadata: Metadata = {
  title: 'Command Center'
};

export const dynamic = 'force-dynamic';

/**
 * Command Center — thin server router. Loads identity + active org + the
 * member's `profiles.member_type`, then dispatches to the matching layout
 * with its typed payload. Every layout handles its own loading / empty /
 * error states; this page only routes.
 *
 * The middleware bidirectional gate guarantees `member_profiles.status` is
 * 'complete' before any user reaches this page; the `memberType === null`
 * fallback below is defensive only.
 */
export default async function CommandCenterPage() {
  const identity = await getShellIdentity();
  if (!identity) redirect('/login?redirectedFrom=%2Fcommand-center');

  const org = await getActiveOrg();
  const memberProfile = await getMemberProfile();
  const memberType = memberProfile?.memberType ?? null;
  const subtitle = memberType ? MEMBER_TYPE_LABELS[memberType] : 'Your workspace';

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

  const { supabase, userId } = await getDashboardContext();
  if (!userId) redirect('/login?redirectedFrom=%2Fcommand-center');

  const common = await getDashboardCommon(
    supabase,
    org.orgId,
    userId,
    memberType,
    memberProfile?.displayName ?? identity.name ?? 'Welcome'
  );

  let layout: React.ReactNode;
  switch (memberType) {
    case 'investment_firm': {
      const load = await getInvestmentFirmDashboardData(supabase, org.orgId);
      layout = (
        <InvestmentFirmLayout
          displayName={common.member.displayName}
          position={common.member.position}
          trust={common.trust}
          load={load}
        />
      );
      break;
    }
    case 'service_provider': {
      const load = await getServiceProviderDashboardData(supabase, org.orgId);
      layout = (
        <ServiceProviderLayout
          displayName={common.member.displayName}
          position={common.member.position}
          trust={common.trust}
          load={load}
        />
      );
      break;
    }
    case 'startup': {
      const load = await getStartupDashboardData(supabase, org.orgId, userId);
      layout = (
        <StartupLayout
          displayName={common.member.displayName}
          position={common.member.position}
          trust={common.trust}
          load={load}
        />
      );
      break;
    }
    case 'student': {
      const load = await getStudentDashboardData(supabase, org.orgId, userId);
      layout = (
        <StudentLayout
          displayName={common.member.displayName}
          position={common.member.position}
          trust={common.trust}
          load={load}
        />
      );
      break;
    }
    case 'individual_investor': {
      const load = await getIndividualInvestorDashboardData(supabase, org.orgId);
      layout = (
        <IndividualInvestorLayout
          displayName={common.member.displayName}
          position={common.member.position}
          trust={common.trust}
          load={load}
        />
      );
      break;
    }
    default: {
      layout = (
        <Card className="p-8 text-center">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-gold-1">
            One step to go
          </p>
          <p className="mt-2 text-[13.5px] text-fg-1">
            Complete your Proof of Truth so Earn can tune your desk.
          </p>
          <p className="mt-1 text-[11.5px] text-fg-4">
            We&rsquo;ll pick the right dashboard once we know your member type.
          </p>
          <a
            href="/onboarding"
            className="mt-4 inline-flex text-[12px] font-semibold text-azure-1 hover:underline"
          >
            Open onboarding →
          </a>
        </Card>
      );
    }
  }

  return (
    <AppShell title="Command Center" subtitle={subtitle} identity={identity}>
      {layout}
    </AppShell>
  );
}
