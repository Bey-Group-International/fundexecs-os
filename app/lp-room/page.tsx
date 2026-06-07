import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { LpRoom } from '@/components/lp-room';
import { FIXTURE_LP_ROOM } from '@/components/lp-room/fixtures';

export const metadata: Metadata = {
  title: 'Fund Room',
  description:
    'Every LP commitment, update, and answer — on the record. The secure data room for your fund.',
  openGraph: {
    title: 'Fund Room · FundExecs OS',
    description: 'Every LP commitment, update, and answer — on the record.'
  }
};

/**
 * Fund Room (LP Room) — UI-only shell.
 *
 * The page mounts the canonical `<AppShell>` (which renders the unified side
 * rail) and drops in the `<LpRoom>` orchestrator with the default fixture
 * data. Backend (Claude) replaces `FIXTURE_LP_ROOM` with a real
 * `LpRoomData` shape sourced from server queries — the entire UI stays
 * prop-driven by the contracts in `components/lp-room/types.ts`.
 *
 * Submit and document-open handlers are intentionally omitted at this stage
 * so the chat composer + vault rows degrade gracefully (the composer simply
 * accepts the draft and clears the field locally). Wiring those to server
 * actions is part of the backend follow-up.
 */
export default async function LpRoomPage() {
  const identity = await getShellIdentity();
  return (
    <AppShell
      title="Fund Room"
      subtitle="Every commitment, update, and answer — on the record."
      identity={identity}
    >
      <LpRoom data={FIXTURE_LP_ROOM} />
    </AppShell>
  );
}
