import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getActiveOrg } from '@/lib/queries/org';
import { getCapitalStackData } from '@/lib/queries/capital-stack';
import { getActiveRaisePage } from '@/lib/queries/raise-page';
import { CapitalStackView } from '@/components/capital-stack/CapitalStackView';
import { CapitalSearch } from '@/components/capital-stack/CapitalSearch';
import { RaisePageManager } from '@/components/capital-stack/RaisePageManager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Capital Stack',
  description:
    'The live capital structure of your raise — target vs. soft-circled vs. committed vs. closed, broken out by LP type and stage.',
  openGraph: {
    title: 'Capital Stack · FundExecs OS',
    description: 'Live raise structure: target, soft-circled, committed, and gap-to-close.'
  }
};

/**
 * Capital Stack — full UI over `capital_stack_summary` RPC + `capital_commitments`.
 *
 * Renders stage + LP-type breakdowns, gap-to-target, and a commitments table.
 * Binds to the typed `getCapitalStackData` loader with a graceful empty state
 * when no data is available. No migrations; UI-only per Lane 2 guardrails.
 */
export default async function CapitalStackPage() {
  const org = await getActiveOrg().catch(() => null);

  const data = org
    ? await getCapitalStackData(org.orgId).catch(() => ({
        summary: null,
        commitments: [],
        empty: true
      }))
    : { summary: null, commitments: [], empty: true };

  const raisePage = org ? await getActiveRaisePage().catch(() => null) : null;

  return (
    <AuthedShell title="Capital Stack" subtitle="Capital Formation" redirectFrom="/capital-stack">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
        <CapitalSearch commitments={data.commitments} />
        <CapitalStackView data={data} />
        <RaisePageManager key={raisePage?.token ?? 'none'} initial={raisePage} />
      </div>
    </AuthedShell>
  );
}
