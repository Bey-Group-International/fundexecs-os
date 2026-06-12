import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WiresFlow } from '@/components/execute/WiresFlow';
import { getWiresData } from '@/lib/queries/wires';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Signatures & wires',
  description:
    'The instruction ledger behind every close — signatures tracked to resolution, wires advanced one stage at a time on your approval.'
};

/**
 * Signatures & wires — the Execute hub's instruction ledger over the new
 * `signatures` / `wires` tables (20260611280000). Signatures resolve exactly
 * once; wires advance strictly instructed → sent → settled, each stage on
 * your approval. E-sign and banking rails attach later — the record is real
 * from day one.
 */
export default async function ExecuteWiresPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const data = await getWiresData(org.orgId);

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <WiresFlow signatures={data.signatures} wires={data.wires} openClosings={data.openClosings} />
    </div>
  );
}
