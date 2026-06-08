import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getActiveOrg } from '@/lib/queries/org';
import {
  getInboxIntelligenceData,
  type InboxIntelligenceData
} from '@/lib/queries/inbox-intelligence';
import { EMPTY_CALIBRATION } from '@/lib/queries/intelligence-calibration';
import { InboxIntelligenceView } from '@/components/inbox-intelligence/InboxIntelligenceView';

const ROUTE = '/inbox-intelligence';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Inbox Intelligence',
  description:
    'Scored market signals from EDGAR and capital-market sources — each routed to the right specialist on your desk.',
  openGraph: {
    title: 'Inbox Intelligence · FundExecs OS',
    description: 'Scored capital-market signals routed to your specialist desk.'
  }
};

const EMPTY: InboxIntelligenceData = {
  matches: [],
  unroutedSignals: [],
  signalCount: 0,
  calibration: EMPTY_CALIBRATION,
  briefing: null,
  empty: true
};

/**
 * Inbox Intelligence — read-only signal feed over the live `market_signals`
 * table (newest first, by kind, with routed specialist + severity) and the
 * org-scoped `matches` rows where `kind = 'signal'`. Renders grouped, scored
 * cards. Empty until ingestion runs — the view shows a tasteful empty state.
 * Read-only per Intelligence-rail guardrails: no ingestion, no cron, no writes.
 */
export default async function InboxIntelligencePage() {
  const org = await getActiveOrg().catch(() => null);

  const data = org ? await getInboxIntelligenceData(org.orgId).catch(() => EMPTY) : EMPTY;

  return (
    <AuthedShell title="Inbox Intelligence" subtitle="Intelligence" redirectFrom={ROUTE}>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <InboxIntelligenceView data={data} />
      </div>
    </AuthedShell>
  );
}
