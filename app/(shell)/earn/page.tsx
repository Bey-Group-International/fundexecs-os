import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { EarnLedger } from '@/components/earn/EarnLedger';
import { getEarnLedger } from '@/lib/queries/earn-outcomes';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Earn Ledger',
  description:
    'The compounding record of everything your executive team produced — every approved move, where it landed, and the proof behind it.'
};

/** The Earn ledger over the RLS-scoped `earn_outcomes` table. */
export default async function EarnPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const { outcomes, countsByKind } = await getEarnLedger(org.orgId);

  return <EarnLedger outcomes={outcomes} countsByKind={countsByKind} />;
}
