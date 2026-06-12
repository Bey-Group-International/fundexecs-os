import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { DiligenceDocumentsPanel } from '@/components/run/DiligenceDocumentsPanel';
import { StartDiligence, type DiligenceDealOption } from '@/components/run/StartDiligence';
import { getDiligenceDocuments, getDiligenceRun, getDiligenceRuns } from '@/lib/queries/diligence';
import { getActiveOrg } from '@/lib/queries/org';
import { createClient } from '@/lib/supabase/server';
import { DiligenceRunView } from './DiligenceRunView';

export const metadata: Metadata = { title: 'Diligence run' };

/**
 * The diligence center on one run — the prototype's Diligence tab over real
 * routes: switcher chips deep-link between runs, the verdict + risk register
 * read this run, the evidence base sits below, and a new committee review can
 * always be started (the panel's "New review" action anchors here).
 */
export default async function DiligenceRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const { runId } = await params;
  const supabase = await createClient();
  const [run, documents, runs, { data: dealRows }] = await Promise.all([
    getDiligenceRun(runId),
    getDiligenceDocuments(runId),
    getDiligenceRuns(org.orgId),
    supabase
      .from('deals')
      .select('id, name, stage')
      .eq('org_id', org.orgId)
      .neq('stage', 'closed')
      .order('created_at', { ascending: false })
      .limit(12)
  ]);
  if (!run) notFound();

  const deals: DiligenceDealOption[] = (dealRows ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    stage: d.stage
  }));

  return (
    <div className="flex flex-col gap-4">
      <DiligenceRunView run={run} runs={runs} />
      <DiligenceDocumentsPanel
        runId={run.id}
        dealId={run.dealId}
        dealName={run.dealName}
        documents={documents}
      />
      <div id="new-review">
        <StartDiligence deals={deals} />
      </div>
    </div>
  );
}
