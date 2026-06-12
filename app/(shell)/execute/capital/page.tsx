import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CapitalCallsFlow } from '@/components/execute/CapitalCallsFlow';
import { getCapitalCallsData } from '@/lib/queries/capital-calls';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Capital calls',
  description:
    'Drawdowns and distributions against the committed roster — every LP line resolves on your approval, and a call settles only when the last one lands.'
};

/**
 * Capital calls — the Execute hub's drawdown/distribution tracker over the
 * Wave-2 `capital_calls` / `call_lp_status` tables (member writes added by
 * 20260611280000; line amounts + chase records by 20260612220000). Issuing
 * draws against the Capital Map's committed LPs pro-rata to their real
 * commitments; the Distributions view merges the LP Room's `distributions`
 * ledger with call-sourced distributions; a fully funded call settles and
 * feeds the flywheel (`recordLoopClose`).
 */
export default async function ExecuteCapitalPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const data = await getCapitalCallsData(org.orgId);

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <CapitalCallsFlow
        calls={data.calls}
        committedLps={data.committedLps}
        summary={data.summary}
        distributions={data.distributions}
        distributedTotal={data.distributedTotal}
      />
    </div>
  );
}
