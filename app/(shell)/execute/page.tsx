import type { Metadata } from 'next';
import { HubPage } from '@/components/hubs/HubPage';

export const metadata: Metadata = { title: 'Execute' };

/** EXECUTE — drive to close: closings, signatures & wires, capital calls, Chain of Trust. */
export default function ExecuteHubPage() {
  return <HubPage id="execute" />;
}
