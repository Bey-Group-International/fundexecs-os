import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getAdminData } from '@/lib/queries/admin';
import { AdminView } from './AdminView';

export const metadata: Metadata = { title: 'Admin Portal' };

export default async function AdminPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell title="Admin Portal" subtitle="Platform administration">
        <Card className="p-10 text-center">
          <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
            Join or create an organization to manage members, review the audit log, and configure AI
            brains.
          </p>
        </Card>
      </AppShell>
    );
  }

  const data = await getAdminData(org.orgId);

  return (
    <AppShell title="Admin Portal" subtitle="Platform administration">
      <AdminView data={data} />
    </AppShell>
  );
}
