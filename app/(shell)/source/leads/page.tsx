import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LeadEngineFlow } from '@/components/source/LeadEngineFlow';
import { getLeadEngines } from '@/lib/queries/leads';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Lead Engine',
  description:
    'Post-acquisition demand generation — Vivian seeds a scored customer funnel for every closed acquisition, and every move runs on your approval.'
};

/**
 * Lead Engine — the Source hub's fourth module: one demand funnel per closed
 * acquisition. Spin-up runs the real lead-discovery generator (metered, AI);
 * leads advance New → Qualified → Contacted → Meeting one approved step at a
 * time, with the transition enforced server-side.
 */
export default async function SourceLeadsPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const data = await getLeadEngines(org.orgId);

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <LeadEngineFlow engines={data.engines} />
    </div>
  );
}
