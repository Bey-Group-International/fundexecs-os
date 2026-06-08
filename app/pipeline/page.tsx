import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getPipelineData } from '@/lib/queries/pipeline';
import { getLpPipeline } from '@/lib/queries/lp-pipeline';
import { PipelineView } from './PipelineView';

export const metadata: Metadata = { title: 'Pipeline' };

export default async function PipelinePage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell
        identity={await getShellIdentity()}
        title="Pipeline"
        subtitle="Capital formation, deals, LPs & partners"
      >
        <Card className="p-10 text-center">
          <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
            Join or create an organization to start tracking deals across your capital formation
            pipeline.
          </p>
        </Card>
      </AppShell>
    );
  }

  const [data, lpData] = await Promise.all([
    getPipelineData(org.orgId),
    getLpPipeline(org.orgId).catch(() => null)
  ]);

  const lp = lpData ?? {
    columns: [
      { key: 'prospect' as const, label: 'Prospect', lps: [] },
      { key: 'contacted' as const, label: 'Contacted', lps: [] },
      { key: 'soft_circled' as const, label: 'Soft-circle', lps: [] },
      { key: 'committed' as const, label: 'Committed', lps: [] }
    ],
    totalLps: 0,
    committedValue: 0,
    softCircledValue: 0,
    passedCount: 0,
    empty: true
  };

  return (
    <AppShell
      identity={await getShellIdentity()}
      title="Pipeline"
      subtitle="Capital formation, deals, LPs & partners"
    >
      <PipelineView data={data} lpData={lp} />
    </AppShell>
  );
}
