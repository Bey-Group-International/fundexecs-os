import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { GovernanceFlow } from '@/components/governance/GovernanceFlow';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Structure & Governance',
  description:
    'The institutional spine LPs diligence — fund structure, governance bodies (IC, advisory board, LPAC), and copiloted policies. You set the posture; Earn drafts to the standard.'
};

/**
 * Structure & Governance — the prototype's governance hub ported in: structure
 * stack, governance bodies, and copiloted policies. Illustrative (client-side,
 * no DB writes) until governance tables land and counsel signs off. Identity
 * (firm + principal) is read from the live profile.
 */
export default async function BuildGovernancePage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AuthedShell title="Structure & Governance" subtitle="Build" redirectFrom="/build/governance">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <Card className="p-10 text-center">
            <h2 className="text-[15px] font-semibold text-fg-1">No workspace yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
              Your workspace is being set up. Refresh in a moment to set up your governance.
            </p>
          </Card>
        </div>
      </AuthedShell>
    );
  }

  const profile = await getFundProfile(org.orgId).catch(() => null);

  return (
    <AuthedShell title="Structure & Governance" subtitle="Build" redirectFrom="/build/governance">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <GovernanceFlow firm={profile?.fundName || 'your fund'} principal={profile?.managerName || 'You'} />
      </div>
    </AuthedShell>
  );
}
