import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { Card } from '@/components/ui';
import { IntegrationsPanel } from '@/components/integrations/IntegrationsPanel';
import { getActiveOrg } from '@/lib/queries/org';
import { getIntegrationConnections } from '@/lib/queries/integrations';
import { mergeConnections } from '@/lib/integrations/catalog';

export const metadata: Metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell
        title="Integrations"
        subtitle="Connect your tools to power relationship intelligence"
      >
        <Card className="p-10 text-center">
          <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
            Join or create an organization to connect Gmail, Calendar, Slack and more.
          </p>
        </Card>
      </AppShell>
    );
  }

  const rows = await getIntegrationConnections(org.orgId, org.userId);
  const connections = mergeConnections(rows);

  return (
    <AppShell
      identity={await getShellIdentity()}
      title="Integrations"
      subtitle="Connect your tools to power relationship intelligence"
    >
      <IntegrationsPanel connections={connections} variant="page" />
    </AppShell>
  );
}
