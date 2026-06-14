import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ActionQueueView } from '@/components/action-queue/ActionQueueView';
import { getPendingRuns } from '@/lib/queries/action-queue';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Action Queue',
  description:
    'Every run your specialists have prepared and staged for your approval, in one place. Nothing executes until you approve it — and every decision is recorded on the Chain of Trust.'
};

/** The Action Queue — the operator's approve/reject worklist over the
 *  RLS-scoped `task_runs` proposals (Phase 1, P1-A). */
export default async function ActionQueuePage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const runs = await getPendingRuns(org.orgId);

  return <ActionQueueView runs={runs} />;
}
