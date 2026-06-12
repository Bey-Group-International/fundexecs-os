import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WiresFlow } from '@/components/execute/WiresFlow';
import { getWiresData } from '@/lib/queries/wires';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Signatures & wires',
  description:
    'The signature room and money movement — signatures attested to resolution, wires released or confirmed under dual control, each logged to the Chain of Trust.'
};

/**
 * Signatures & wires — the Execute hub's signature room and wire board over
 * the `signatures` / `wires` tables (20260611280000 + 20260612220000).
 * Signatures only move forward (awaiting → partial → signed | declined);
 * wires clear exactly once by direction (staged → cleared on release,
 * expected → cleared on confirm), each on your approval. E-sign and banking
 * rails attach later — the record is real from day one.
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
