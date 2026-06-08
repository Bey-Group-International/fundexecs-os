import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getActiveOrg } from '@/lib/queries/org';
import { getCapTableData } from '@/lib/queries/cap-table';
import { CapTableView } from '@/components/cap-table/CapTableView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cap Table',
  description:
    'Fully-diluted ownership breakdown — founders, investors, option pools, and SAFEs — with a holdings table and investment totals.',
  openGraph: {
    title: 'Cap Table · FundExecs OS',
    description:
      'AngelList-style ownership breakdown: holders, security types, and invested capital.'
  }
};

/**
 * Cap Table — ownership/holdings surface.
 *
 * Loads `cap_table_entries` via the authed RLS-gated query and renders
 * a donut breakdown by holder type, a stacked-bar visual, and a full
 * holdings table. Returns an honest empty state when no entries exist.
 */
export default async function CapTablePage() {
  const org = await getActiveOrg().catch(() => null);

  const data = org
    ? await getCapTableData(org.orgId).catch(() => ({
        entries: [],
        summary: { totalUnits: 0, totalInvested: 0, ownershipByType: {} },
        empty: true
      }))
    : {
        entries: [],
        summary: { totalUnits: 0, totalInvested: 0, ownershipByType: {} },
        empty: true
      };

  return (
    <AuthedShell title="Cap Table" subtitle="Ownership" redirectFrom="/cap-table">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <CapTableView data={data} />
      </div>
    </AuthedShell>
  );
}
