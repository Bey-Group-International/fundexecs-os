import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getEarnTasks } from '@/lib/queries/ask-earn';
import { AskEarnView } from './AskEarnView';

export const metadata: Metadata = { title: 'Ask Earn' };

export default async function AskEarnPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell title="Ask Earn" subtitle="Earnest Fundmaker · your private-market assistant">
        <Card className="p-10 text-center">
          <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
            Join or create an organization so Earn can manage tasks and run workflows on your
            behalf.
          </p>
        </Card>
      </AppShell>
    );
  }

  const tasks = await getEarnTasks(org.orgId);

  return (
    <AppShell title="Ask Earn" subtitle="Earnest Fundmaker · your private-market assistant">
      <AskEarnView initialTasks={tasks} />
    </AppShell>
  );
}
