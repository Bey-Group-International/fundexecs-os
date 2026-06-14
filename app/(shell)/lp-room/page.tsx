import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LpRoomFlow } from '@/components/lp-room/LpRoomFlow';
import { getLpRoomData } from '@/lib/queries/lp-room';
import { requireOrgManager } from '@/lib/access.server';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'LP Room',
  description:
    'Your investor-ready room — fund overview, document vault, update feed, commitment tracker, and an Earn-answered LP Q&A, all on the record.'
};

/**
 * LP Room — the Juniper-Square-style investor room, manager side. Renders the
 * org's live room data (overview, documents, updates, commitments, Q&A) and
 * lets the GP answer LP questions with Earn, grounded in approved materials.
 */
export default async function LpRoomPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [data, canAnswer] = await Promise.all([
    getLpRoomData(org.orgId),
    requireOrgManager(org.orgId)
  ]);

  return (
    <div className="fx-rise mx-auto max-w-[980px]">
      <LpRoomFlow data={data} canAnswer={canAnswer} />
    </div>
  );
}
