import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { Card } from '@/components/ui';
import { LpRoom } from '@/components/lp-room';
import { getActiveOrg } from '@/lib/queries/org';
import { getLpRoomData } from '@/lib/queries/lp-room';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Fund Room' },
  description:
    'Every LP commitment, update, and answer on the record — the shared room where managers and investors stay in sync.',
  openGraph: {
    title: 'FundExecs OS — Fund Room',
    description:
      'Every LP commitment, update, and answer on the record — the shared room where managers and investors stay in sync.'
  }
};

export default async function LpRoomPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AuthedShell
        title="Fund Room"
        subtitle="Every commitment, update, and answer — on the record."
        redirectFrom="/lp-room"
      >
        <Card className="p-6">
          <p className="text-[13px] font-semibold text-fg-1">No active workspace</p>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-fg-3">
            Join or create a workspace before opening the Fund Room.
          </p>
          <Link
            href="/onboarding"
            className="mt-4 inline-flex rounded-xl border border-hairline bg-bg-1 px-3 py-2 text-[12px] font-semibold text-fg-2 transition hover:bg-surface-2"
          >
            Set up workspace
          </Link>
        </Card>
      </AuthedShell>
    );
  }

  const data = await getLpRoomData(org.orgId);

  return (
    <AuthedShell
      title="Fund Room"
      subtitle="Every commitment, update, and answer — on the record."
      redirectFrom="/lp-room"
    >
      <LpRoom data={data} />
    </AuthedShell>
  );
}
