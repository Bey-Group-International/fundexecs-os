import type { Metadata } from 'next';
import { HubPage } from '@/components/hubs/HubPage';

export const metadata: Metadata = { title: 'Build' };

/** BUILD — stand it up: formation, governance, materials, profile & brand. */
export default function BuildHubPage() {
  return <HubPage id="build" />;
}
