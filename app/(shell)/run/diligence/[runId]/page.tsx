import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getDiligenceRun } from '@/lib/queries/diligence';
import { getActiveOrg } from '@/lib/queries/org';
import { DiligenceRunView } from './DiligenceRunView';

export const metadata: Metadata = { title: 'Diligence run' };

/** One committee verdict: Earn's synthesis first, then the six analysts. */
export default async function DiligenceRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const { runId } = await params;
  const run = await getDiligenceRun(runId);
  if (!run) notFound();

  return (
    <div className="fx-rise mx-auto max-w-[920px]">
      <DiligenceRunView run={run} />
    </div>
  );
}
