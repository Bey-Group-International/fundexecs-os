import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { ConnectionsView } from './ConnectionsView';

export const metadata: Metadata = { title: 'Connections' };

export default function ConnectionsPage() {
  return (
    <AppShell title="Connections" subtitle="Relationship intelligence and warm introductions">
      <ConnectionsView />
    </AppShell>
  );
}
