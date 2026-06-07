import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getActiveOrg } from '@/lib/queries/org';
import { getPartnersData } from '@/lib/queries/partners';
import { PartnersView } from '@/components/partners/PartnersView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Partner Marketplace',
  description:
    "Your organization's service providers and capital providers — the full partner directory.",
  openGraph: {
    title: 'Partner Marketplace · FundExecs OS',
    description: 'Service providers and capital providers — your full partner directory.'
  }
};

/**
 * Partner Marketplace — full UI over service_providers + capital_providers.
 *
 * Renders a searchable, filterable directory of both provider types. Binds to
 * the typed `getPartnersData` loader with a graceful empty state when no data
 * is available. No migrations; UI-only per Lane 2 guardrails.
 */
export default async function PartnersPage() {
  const org = await getActiveOrg().catch(() => null);

  const data = org
    ? await getPartnersData(org.orgId).catch(() => ({
        serviceProviders: [],
        capitalProviders: [],
        empty: true
      }))
    : { serviceProviders: [], capitalProviders: [], empty: true };

  return (
    <AuthedShell title="Partner Marketplace" subtitle="Partner Directory" redirectFrom="/partners">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <PartnersView data={data} />
      </div>
    </AuthedShell>
  );
}
