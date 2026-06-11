import type { Metadata } from 'next';
import { HubPage } from '@/components/hubs/HubPage';

export const metadata: Metadata = { title: 'Source' };

/** SOURCE — find & raise: pipeline, LP targets, partners, lead engine. */
export default function SourceHubPage() {
  return <HubPage id="source" />;
}
