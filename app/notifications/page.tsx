import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getNotifications } from '@/lib/queries/notifications';
import { NotificationsView } from './NotificationsView';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell
        identity={await getShellIdentity()}
        title="Notifications"
        subtitle="Your private-market inbox"
      >
        <Card className="p-10 text-center">
          <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
            Join or create an organization to start receiving synergy alerts, LP interest signals,
            and copilot updates.
          </p>
        </Card>
      </AppShell>
    );
  }

  const notifications = await getNotifications(org.userId);

  return (
    <AppShell
      identity={await getShellIdentity()}
      title="Notifications"
      subtitle="Your private-market inbox"
    >
      <NotificationsView initial={notifications} />
    </AppShell>
  );
}
