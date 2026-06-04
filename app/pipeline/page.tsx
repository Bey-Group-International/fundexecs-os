import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getPipelineData } from '@/lib/queries/pipeline';
import { PipelineView } from './PipelineView';

export const metadata: Metadata = { title: 'Pipeline' };

export default async function PipelinePage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell title="Pipeline" subtitle="Capital formation, deals, LPs & partners">
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

  const data = await getPipelineData(org.orgId);

  return (
    <AppShell title="Pipeline" subtitle="Capital formation, deals, LPs & partners">
      <PipelineView data={data} />
    </AppShell>
  );
}
