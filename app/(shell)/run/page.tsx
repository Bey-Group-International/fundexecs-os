import type { Metadata } from 'next';
import { HubPage } from '@/components/hubs/HubPage';

export const metadata: Metadata = { title: 'Run' };

/** RUN — operate: diligence, workflows, compliance, IR & reporting. */
export default function RunHubPage() {
  return <HubPage id="run" />;
}
