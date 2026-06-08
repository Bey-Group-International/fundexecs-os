import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getLpRoomData } from '@/lib/queries/lp-room';
import { LpRoom } from '@/components/lp-room';
import {
  FIXTURE_LP_ROOM,
  FIXTURE_DISTRIBUTIONS,
  FIXTURE_CAPITAL_ACCOUNT
} from '@/components/lp-room/fixtures';
import type { LpRoomData } from '@/components/lp-room/types';

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

/**
 * Fund Room (LP Room) — distributions, capital-account statements, and
 * periodic investor reporting (W3).
 *
 * The page resolves the active org and queries the `distributions` and
 * `capital_account_entries` tables. When there is no DB data (empty org,
 * unauthenticated, or first-time user) it falls back to the fixture set and
 * marks `isCapitalDataSample: true` so the UI can badge sample rows clearly.
 *
 * The remaining surfaces (updates/docs/Q&A/commitments) stay fixture-driven
 * until their own backend wiring lands.
 */
export default async function LpRoomPage() {
  const [identity, activeOrg] = await Promise.all([getShellIdentity(), getActiveOrg()]);

  let data: LpRoomData;

  if (activeOrg) {
    const dbData = await getLpRoomData(activeOrg.orgId);

    if (!dbData.empty) {
      // Merge real capital data with existing fixture surfaces (updates/docs/etc.)
      data = {
        ...FIXTURE_LP_ROOM,
        distributions: dbData.distributions.map((d) => ({
          id: d.id,
          distributionDate: d.distributionDate,
          kind: d.kind,
          amount: d.amount,
          status: d.status,
          memo: d.memo
        })),
        capitalAccount: dbData.capitalAccountSummary,
        isCapitalDataSample: false
      };
    } else {
      // No DB rows yet — use fixture sample data, clearly marked
      data = FIXTURE_LP_ROOM;
    }
  } else {
    // No active org — show full fixture set
    data = {
      ...FIXTURE_LP_ROOM,
      distributions: FIXTURE_DISTRIBUTIONS,
      capitalAccount: FIXTURE_CAPITAL_ACCOUNT,
      isCapitalDataSample: true
    };
  }

  return (
    <AppShell
      title="Fund Room"
      subtitle="Every commitment, update, and answer — on the record."
      identity={identity}
    >
      <LpRoom data={data} />
    </AppShell>
  );
}
