import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { getActiveOrg } from '@/lib/queries/org';
import { getMandate } from '@/lib/queries/mandate';
import { getMemberProfile } from '@/lib/queries/member-profile';
import { RecommendationsFlow } from './RecommendationsFlow';

export const metadata: Metadata = {
  title: 'Recommendations',
  description: 'Answer a few questions and get a tailored action plan from your executive team.'
};

export default async function RecommendationsPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [mandate, profile] = await Promise.all([getMandate(org.orgId), getMemberProfile()]);

  const context = {
    memberType: profile?.memberType ?? null,
    objective: mandate?.objective ?? null,
    principal: mandate?.principal ?? null
  };

  return (
    <div className="fx-rise mx-auto max-w-[680px]">
      <div className="mb-6 flex items-start gap-3">
        <EarnCoin size={40} online className="flex-none" />
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-fg-1">
            Get Recommendations
          </h1>
          <p className="mt-0.5 text-[12.5px] text-fg-4">
            Answer a few questions — your executive team returns a ranked action plan, specific to
            where you are in the lifecycle.
          </p>
        </div>
      </div>
      <RecommendationsFlow context={context} />
    </div>
  );
}
