import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getDiligenceRuns } from '@/lib/queries/diligence';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { convictionTone, statusTone, statusLabel } from './ui';

export const metadata: Metadata = { title: 'Diligence' };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return iso;
  }
}

export default async function DiligencePage() {
  const org = await getActiveOrg();
  if (!org) redirect('/login');

  const runs = await getDiligenceRuns(org.orgId);

  return (
    <AppShell
      identity={await getShellIdentity()}
      title="Diligence"
      subtitle="Earn's investment committee — 7-agent diligence runs"
    >
      <div className="flex flex-col gap-[18px]">
        <SectionTitle
          eyebrow="Diligence Intelligence Layer"
          title="Diligence runs"
          className="mb-0"
        />

        {runs.length === 0 ? (
          <Card className="p-10 text-center">
            <h2 className="text-[15px] font-semibold text-fg-1">No diligence runs yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
              Open a deal in the pipeline and use{' '}
              <span className="font-medium text-fg-2">Run diligence</span> to have Earn&rsquo;s
              committee review it like an institutional LP.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2.5">
            {runs.map((run) => (
              <Link key={run.id} href={`/diligence/${run.id}`} className="block">
                <Card className="flex items-center gap-4 p-4 transition hover:border-[var(--accent-line)]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-fg-1">
                      {run.summary || 'Diligence review'}
                    </div>
                    <div className="mt-1 text-[11px] text-fg-4">
                      {formatDate(run.createdAt)} · {run.findingCount}{' '}
                      {run.findingCount === 1 ? 'finding' : 'findings'}
                    </div>
                  </div>
                  <Badge tone={statusTone(run.status)} className="flex-none text-[10px]">
                    {statusLabel(run.status)}
                  </Badge>
                  {run.conviction != null ? (
                    <Badge tone={convictionTone(run.conviction)} className="flex-none text-[10px]">
                      Conviction {run.conviction}
                    </Badge>
                  ) : null}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
