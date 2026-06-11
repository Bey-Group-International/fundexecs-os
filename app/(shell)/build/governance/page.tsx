import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GovernanceFlow } from '@/components/governance/GovernanceFlow';
import { getFormationState } from '@/lib/queries/formation';
import { getGovernanceHubState } from '@/lib/queries/governance-hub';
import { getMandate } from '@/lib/queries/mandate';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Structure & Governance',
  description:
    'The institutional spine LPs diligence — fund structure, governance bodies (IC, advisory board, LPAC), and copiloted policies. You set the posture; Earn drafts to the standard.'
};

/**
 * Structure & Governance — the Build hub's governance interior: the legal
 * stack (personalized from the persisted formation document), body rosters,
 * and copiloted policies. Adopted policies and edited rosters persist to
 * `governance_policies` / `governance_bodies` (org-scoped RLS). Illustrative
 * until counsel signs off.
 */
export default async function BuildGovernancePage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [mandate, formation, governance] = await Promise.all([
    getMandate(org.orgId),
    getFormationState(org.orgId),
    getGovernanceHubState(org.orgId)
  ]);

  const firm = mandate?.firm ?? 'Your fund';
  const principal = mandate?.principal ?? 'You';
  const entity =
    formation.data.entity === 'Undecided' ? 'Delaware LP' : formation.data.entity;
  const gp = formation.data.gp === 'GP, LLC' ? `${firm} GP, LLC` : formation.data.gp;
  const mgmtco =
    formation.data.mgmtco === 'Management, LLC'
      ? `${firm} Management, LLC`
      : formation.data.mgmtco;

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <GovernanceFlow
        firm={firm}
        principal={principal}
        structure={{ entity, gp, mgmtco }}
        initialAdopted={governance.adopted}
        initialBodies={governance.bodies}
      />
    </div>
  );
}
