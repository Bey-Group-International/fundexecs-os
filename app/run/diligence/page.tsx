import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { DiligenceDeskFlow } from '@/components/diligence-desk/DiligenceDeskFlow';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Diligence Desk',
  description:
    'Run the analysis that decides. A panel of agents runs each diligence workstream on your live deals — you review the findings, clear the open items, and reach an IC-ready verdict.'
};

/**
 * Diligence Desk — the prototype's multi-agent diligence verdict surface ported
 * in: a panel of agents runs each workstream per deal, with a risk register, an
 * escalating IC verdict, and a copiloted resolution flow that clears open items.
 * Illustrative (client-side, no diligence writes) — distinct from the live
 * diligence backend in `lib/diligence/*` — until that schema surfaces here.
 */
export default async function DiligenceDeskPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AuthedShell title="Diligence Desk" subtitle="Run" redirectFrom="/run/diligence">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <Card className="p-10 text-center">
            <h2 className="text-[15px] font-semibold text-fg-1">No workspace yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
              Your workspace is being set up. Refresh in a moment to run diligence on your deals.
            </p>
          </Card>
        </div>
      </AuthedShell>
    );
  }

  const profile = await getFundProfile(org.orgId).catch(() => null);

  return (
    <AuthedShell title="Diligence Desk" subtitle="Run" redirectFrom="/run/diligence">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <DiligenceDeskFlow firm={profile?.fundName || 'your fund'} />
      </div>
    </AuthedShell>
  );
}
