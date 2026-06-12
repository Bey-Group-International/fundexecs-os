import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DealPipelineFlow } from '@/components/source/DealPipelineFlow';
import { getPipelineData } from '@/lib/queries/pipeline';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Deal Pipeline',
  description:
    'Your pipeline on one board — every deal staged and fit-scored against the mandate. Earn drafts each advance; nothing moves until you approve.'
};

/**
 * Deal Pipeline — the Source hub's second deep module, on real data: deals
 * grouped by the canonical formation stages via `getPipelineData` (with real
 * allocations + diligence runs in the drawer), and every "with Earn" advance
 * running the approve loop over the existing `updateDealStage` action (which
 * fires Chain-of-Trust XP and loop events).
 */
export default async function SourcePipelinePage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const data = await getPipelineData(org.orgId);

  return (
    <DealPipelineFlow
      stages={data.stages}
      pipelineValue={data.pipelineValue}
      committed={data.committed}
    />
  );
}
