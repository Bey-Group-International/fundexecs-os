import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WorkflowsFlow } from '@/components/run/WorkflowsFlow';
import { getWorkflows } from '@/lib/queries/run-ops';
import { getActiveOrg } from '@/lib/queries/org';

export const metadata: Metadata = {
  title: 'Workflows & Tasks',
  description:
    "Sterling's sequenced operating plan — launch, raise and pipeline streams, every step started and completed on your approval."
};

/** Workflows — Sterling's operating plan over the Wave-3 workflow tables. */
export default async function RunWorkflowsPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');
  const workflows = await getWorkflows(org.orgId);
  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <WorkflowsFlow workflows={workflows} />
    </div>
  );
}
