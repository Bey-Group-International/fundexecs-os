import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { DataRoomFlow } from '@/components/dataroom/DataRoomFlow';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Materials & Data Room',
  description:
    'Generate investor materials the copiloted way, then serve them from one secure data room — vetted per-document links, accredited + NDA gating, and tracked access. You approve; Earn drafts.'
};

/**
 * Materials & Data Room — the prototype's investor-facing surface ported in:
 * copiloted material builders + a live data room with secure per-document links,
 * an accredited-+-NDA vetting gate, and tracked LP access. Illustrative
 * (client-side, no documents/storage writes) until a data-room schema lands.
 */
export default async function DataRoomPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AuthedShell title="Materials & Data Room" subtitle="Build" redirectFrom="/build/data-room">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <Card className="p-10 text-center">
            <h2 className="text-[15px] font-semibold text-fg-1">No workspace yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
              Your workspace is being set up. Refresh in a moment to build your materials and data room.
            </p>
          </Card>
        </div>
      </AuthedShell>
    );
  }

  const profile = await getFundProfile(org.orgId).catch(() => null);

  return (
    <AuthedShell title="Materials & Data Room" subtitle="Build" redirectFrom="/build/data-room">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <DataRoomFlow firm={profile?.fundName || 'your fund'} />
      </div>
    </AuthedShell>
  );
}
