import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PartnerNetworkFlow } from '@/components/source/PartnerNetworkFlow';
import { getPartnersData } from '@/lib/queries/partners';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Partner Network',
  description:
    'Your vetted bench — fund counsel, administration, audit and placement. Earn drafts every introduction; requests are tracked until the provider is engaged.'
};

/**
 * Partner Network — the Source hub's vetted bench, on real data: service
 * providers from `getPartnersData` with bench stage derived from the
 * provider's status + tracked `partner_intro_requests`. "Request intro" runs
 * the approve loop over the existing idempotent `requestPartnerIntro` action.
 * Capital partners stay on the LP Capital Map (one home per relationship).
 */
export default async function SourcePartnersPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const data = await getPartnersData(org.orgId);

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <PartnerNetworkFlow providers={data.serviceProviders} introStatus={data.introStatus} />
    </div>
  );
}
