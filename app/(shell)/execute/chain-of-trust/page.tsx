import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ChainOfTrustFlow } from '@/components/execute/ChainOfTrustFlow';
import { getTrustCenterData } from '@/lib/queries/trust-center';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Chain of Trust',
  description:
    'The four-layer proof ledger every module writes to — claims become evidence, evidence gets approved, and the record compounds into institutional readiness.'
};

/**
 * Chain of Trust — the Execute hub's proof ledger over the preserved
 * Proof-of-Truth spine (`chain_of_trust_records`, `proof_layers`, evidence
 * + approvals). Read through `getTrustCenterData` (the capital-weighted
 * Institutional Readiness Index); the approval queue runs through the
 * preserved `approveEvidence` action via the approve loop.
 */
export default async function ExecuteChainOfTrustPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const data = await getTrustCenterData(org.orgId);

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <ChainOfTrustFlow data={data} />
    </div>
  );
}
