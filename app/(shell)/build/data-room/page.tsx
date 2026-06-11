import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DataRoomFlow } from '@/components/dataroom/DataRoomFlow';
import { getDataRoomState } from '@/lib/queries/data-room';
import { getMandate } from '@/lib/queries/mandate';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Materials & Data Room',
  description:
    'Generate investor materials the copiloted way, then serve them from one secure data room — vetted per-document links, accredited + NDA gating, and tracked access. You approve; Earn drafts.'
};

/**
 * Materials & Data Room — the Build hub's investor-facing interior: copiloted
 * material builders (persisted to `capital_materials` with the operator's
 * spec) and a live room with real vetted links (`data_room_links`). View
 * logging belongs to the future public `/dr/[token]` route — the recipient
 * gate here is a labelled preview that records nothing.
 */
export default async function BuildDataRoomPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const [mandate, room] = await Promise.all([getMandate(org.orgId), getDataRoomState(org.orgId)]);

  return (
    <div className="fx-rise">
      <DataRoomFlow
        firm={mandate?.firm ?? 'Your fund'}
        initialStages={room.stages}
        initialSpecs={room.specs}
        initialLinks={room.links}
        initialActivity={room.activity}
      />
    </div>
  );
}
