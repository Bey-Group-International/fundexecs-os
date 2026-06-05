import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getConnectionsData } from '@/lib/queries/connections';
import { ConnectionsView } from './ConnectionsView';

export const metadata: Metadata = { title: 'Connections' };

export default async function ConnectionsPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell
        identity={await getShellIdentity()}
        title="Connections"
        subtitle="Relationship intelligence and warm introductions"
      >
        <Card className="p-10 text-center">
          <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
            Join or create an organization to start tracking your relationships and warm
            introductions.
          </p>
        </Card>
      </AppShell>
    );
  }

  const { rows, intros } = await getConnectionsData(org.orgId);

  return (
    <AppShell
      identity={await getShellIdentity()}
      title="Connections"
      subtitle="Relationship intelligence and warm introductions"
    >
      <ConnectionsView rows={rows} intros={intros} />
    </AppShell>
  );
}
