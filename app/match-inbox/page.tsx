import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getActiveOrg } from '@/lib/queries/org';
import { getMatchInboxData } from '@/lib/queries/match-inbox';
import { MatchInboxView } from '@/components/match-inbox/MatchInboxView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Match Inbox',
  description:
    'AI-generated match recommendations for triage — accept or dismiss to shape your deal flow and relationship graph.',
  openGraph: {
    title: 'Match Inbox · FundExecs OS',
    description: 'AI match recommendations — accept or dismiss to shape your deal flow.'
  }
};

/**
 * Match Inbox — full UI over the `matches` table.
 *
 * Renders pending matches for triage (accept / dismiss) and a history of
 * actioned matches. Calls the `act_on_match` server action (placeholder
 * implementation in lib/actions/matches.ts; Claude's backend replaces it).
 * Binds to the typed `getMatchInboxData` loader with a graceful empty state.
 */
export default async function MatchInboxPage() {
  const org = await getActiveOrg().catch(() => null);

  const data = org
    ? await getMatchInboxData(org.orgId).catch(() => ({
        pending: [],
        actioned: [],
        empty: true
      }))
    : { pending: [], actioned: [], empty: true };

  return (
    <AuthedShell title="Match Inbox" subtitle="AI Matching" redirectFrom="/match-inbox">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <MatchInboxView data={data} />
      </div>
    </AuthedShell>
  );
}
