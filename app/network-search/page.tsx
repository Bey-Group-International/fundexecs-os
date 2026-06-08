import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { NetworkSearchView } from '@/components/network/NetworkSearchView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Network Search',
  description:
    'Hybrid LP & Partner search — semantic + keyword + filters across your contacts, service providers, and capital providers, with warm-intro flags.',
  openGraph: {
    title: 'Network Search · FundExecs OS',
    description: 'Search LPs, partners, and contacts by meaning, keyword, and mandate fit.'
  }
};

/**
 * Network Search — LP & Partner hybrid retrieval surface. Runs the
 * `runNetworkSearch` action (semantic via Voyage + keyword + filters over the
 * org's contacts / service_providers / capital_providers) and renders ranked
 * results with "already in your network" badges for warm-intro paths.
 */
export default function NetworkSearchPage() {
  return (
    <AuthedShell
      title="Network Search"
      subtitle="LP & Partner search"
      redirectFrom="/network-search"
    >
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <NetworkSearchView />
      </div>
    </AuthedShell>
  );
}
