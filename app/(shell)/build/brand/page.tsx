import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BrandStudioFlow } from '@/components/brand-studio/BrandStudioFlow';
import { getBrandStudioDoc } from '@/lib/queries/brand-studio';
import { getIntegrationConnections } from '@/lib/queries/integrations';
import { getMandate } from '@/lib/queries/mandate';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Profile & Brand',
  description:
    'The public face of your raise — your GP profile, firm brand kit, and digital presence, produced copiloted from your fund story. You set the posture; Earn produces it.'
};

/**
 * Profile & Brand — the Build hub's brand interior: GP profile, firm brand
 * kit, and digital presence, each produced through a copiloted builder and
 * persisted to the org's `brand_studio` document. The Connections panel reads
 * the REAL integrations layer (gmail / calendar / calendly / slack connect via
 * the existing OAuth routes; the rest say "Soon" honestly).
 */
export default async function BuildBrandPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [mandate, doc, providerConnections] = await Promise.all([
    getMandate(org.orgId),
    getBrandStudioDoc(org.orgId),
    getIntegrationConnections(org.orgId, org.userId)
  ]);

  const connections = Object.fromEntries(
    providerConnections.map((c) => [c.provider, c.status === 'connected'])
  );

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <BrandStudioFlow
        firm={mandate?.firm ?? 'Your fund'}
        principal={mandate?.principal ?? 'Managing Partner'}
        initialDoc={doc}
        connections={connections}
      />
    </div>
  );
}
