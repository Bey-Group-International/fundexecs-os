import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getDiligenceRun } from '@/lib/queries/diligence';
import { DiligenceRunView } from './DiligenceRunView';

export const metadata: Metadata = { title: 'Diligence run' };

export default async function DiligenceRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const org = await getActiveOrg();
  if (!org) redirect('/login');

  const { runId } = await params;
  const run = await getDiligenceRun(runId);
  if (!run) notFound();

  return (
    <AppShell
      identity={await getShellIdentity()}
      title="Diligence run"
      subtitle={run.dealName ? `Review of ${run.dealName}` : 'Earn investment committee review'}
    >
      <DiligenceRunView run={run} />
    </AppShell>
  );
}
