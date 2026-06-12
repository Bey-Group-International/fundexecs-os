import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WiresFlow } from '@/components/execute/WiresFlow';
import { getWiresData } from '@/lib/queries/wires';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Signatures & wires',
  description:
    'The signature room & money movement — attestations tracked to resolution, wires staged and cleared under dual-control approval, everything logged to the Chain of Trust.'
};

/**
 * Signatures & wires — the Execute hub's attestation ledger over the
 * `signatures` / `wires` tables (20260611280000 + 20260612190000).
 * Signatures resolve exactly once; wires clear in one server-enforced
 * transition (staged → cleared on release, expected → cleared on confirm),
 * and terminal events log real Proof of Execution rows to the Chain of
 * Trust. E-sign and banking rails attach later — the record is real from
 * day one.
 */
export default async function ExecuteWiresPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const data = await getWiresData(org.orgId);

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <WiresFlow
        signatures={data.signatures}
        wires={data.wires}
        totals={data.totals}
        openClosings={data.openClosings}
      />
    </div>
  );
}
