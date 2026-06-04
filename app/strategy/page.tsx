import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getStrategyData } from '@/lib/queries/strategy';
import { StrategyView } from './StrategyView';

export const metadata: Metadata = { title: 'Strategy' };

export default async function StrategyPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell title="Strategy" subtitle="100 / 30 / 10 operating plan">
        <Card className="p-10 text-center">
          <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
            Join or create an organization to build your 100 / 30 / 10 operating plan and track
            objectives.
          </p>
        </Card>
      </AppShell>
    );
  }

  const { objectives } = await getStrategyData(org.orgId);

  return (
    <AppShell title="Strategy" subtitle="100 / 30 / 10 operating plan">
      <StrategyView initialObjectives={objectives} />
    </AppShell>
  );
}
