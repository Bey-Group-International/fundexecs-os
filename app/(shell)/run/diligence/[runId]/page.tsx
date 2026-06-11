import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { DiligenceDocumentsPanel } from '@/components/run/DiligenceDocumentsPanel';
import { getDiligenceDocuments, getDiligenceRun } from '@/lib/queries/diligence';
import { getActiveOrg } from '@/lib/queries/org';
import { DiligenceRunView } from './DiligenceRunView';

export const metadata: Metadata = { title: 'Diligence run' };

/**
 * One committee verdict: Earn's synthesis first, then the six analysts, then
 * the evidence base — upload documents, watch them index, re-run the review.
 */
export default async function DiligenceRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const { runId } = await params;
  const [run, documents] = await Promise.all([
    getDiligenceRun(runId),
    getDiligenceDocuments(runId)
  ]);
  if (!run) notFound();

  return (
    <div className="fx-rise mx-auto flex max-w-[920px] flex-col gap-[18px]">
      <DiligenceRunView run={run} />
      <DiligenceDocumentsPanel
        runId={run.id}
        dealId={run.dealId}
        dealName={run.dealName}
        documents={documents}
      />
    </div>
  );
}
