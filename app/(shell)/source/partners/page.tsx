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
 * providers from `getPartnersData` with the Suggested → Contacted → Engaged
 * ladder derived from the provider's status + tracked
 * `partner_intro_requests` (see `lib/partners/bench.ts`). Every advance —
 * "Request intro", then "Engage" — runs the approve loop over a real server
 * action. Capital partners stay on the LP Capital Map (one home per
 * relationship).
 */
export default async function SourcePartnersPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const data = await getPartnersData(org.orgId);

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <PartnerNetworkFlow
        providers={data.serviceProviders}
        introStatus={data.introStatus}
        introActivity={data.introActivity}
      />
    </div>
  );
}
