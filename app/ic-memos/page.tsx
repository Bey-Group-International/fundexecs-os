import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, FileSignature, Gauge, CheckCircle2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getDiligenceRuns, type DiligenceRunSummary } from '@/lib/queries/diligence';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { convictionTone, statusLabel, statusTone } from '@/app/diligence/ui';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — IC Memos' },
  description: 'The investment-committee memo library — conviction, status, and findings per run.'
};

const SUBTITLE = "Earn's investment committee — memos from every diligence run";

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

function NoOrg({ identity }: { identity: Awaited<ReturnType<typeof getShellIdentity>> }) {
  return (
    <AppShell identity={identity} title="IC Memos" subtitle={SUBTITLE}>
      <Card className="p-10 text-center">
        <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
        <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
          Join or create an organization to run diligence and build your investment-committee memo
          library.
        </p>
      </Card>
    </AppShell>
  );
}

export default async function IcMemosPage() {
  const [org, identity] = await Promise.all([getActiveOrg(), getShellIdentity()]);
  if (!org) return <NoOrg identity={identity} />;

  const runs = await getDiligenceRuns(org.orgId);

  const completed = runs.filter((r) => r.status === 'complete');
  const convictions = completed
    .map((r) => r.conviction)
    .filter((c): c is number => typeof c === 'number');
  const avgConviction = convictions.length
    ? Math.round(convictions.reduce((s, c) => s + c, 0) / convictions.length)
    : 0;

  const kpis = [
    { label: 'Total memos', value: `${runs.length}`, icon: FileSignature },
    { label: 'Completed', value: `${completed.length}`, icon: CheckCircle2 },
    { label: 'Avg conviction', value: avgConviction ? `${avgConviction}` : '—', icon: Gauge }
  ];

  return (
    <AppShell identity={identity} title="IC Memos" subtitle={SUBTITLE}>
      <div className="flex flex-col gap-[18px]">
        <SectionTitle
          eyebrow="Deal execution"
          title="Investment-committee memos"
          className="mb-0"
        />

        {runs.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-surface-2">
              <FileSignature size={20} strokeWidth={1.8} className="text-fg-3" aria-hidden />
            </span>
            <h3 className="text-[15px] font-semibold text-fg-1">No IC memos yet</h3>
            <p className="max-w-md text-[12.5px] leading-relaxed text-fg-4">
              Open a deal on the desk and run diligence — Earn&rsquo;s seven-agent committee reviews
              it like an institutional LP and writes the memo here, with conviction and findings.
            </p>
            <Link
              href="/deal-desk"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl border border-transparent bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-4 py-2.5 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110"
            >
              Go to the desk
              <ArrowUpRight size={16} strokeWidth={1.9} aria-hidden />
            </Link>
          </Card>
        ) : (
          <>
            {/* Conviction-led summary band. */}
            <Card className="grid gap-px overflow-hidden bg-hairline p-0 sm:grid-cols-3">
              {kpis.map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="bg-[linear-gradient(150deg,rgba(247,201,72,0.06),transparent_62%)] bg-surface-1 p-[18px]"
                >
                  <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                    <Icon size={13} strokeWidth={2} aria-hidden />
                    {label}
                  </div>
                  <div className="mt-2.5 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                    {value}
                  </div>
                </div>
              ))}
            </Card>

            <div className="flex flex-col gap-2.5">
              {runs.map((run: DiligenceRunSummary) => (
                <Link key={run.id} href={`/diligence/${run.id}`} className="block">
                  <Card clickable className="flex items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-fg-1">
                        {run.summary || 'Diligence review'}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-4">
                        <span>{formatDate(run.createdAt)}</span>
                        <span className="tabular-nums">
                          {run.findingCount} {run.findingCount === 1 ? 'finding' : 'findings'}
                        </span>
                      </div>
                    </div>
                    {run.conviction != null ? (
                      <div className="hidden w-28 flex-none sm:block">
                        <div className="mb-1 flex items-baseline justify-between text-[10px] text-fg-4">
                          <span>Conviction</span>
                          <span className="tabular-nums text-fg-2">{run.conviction}</span>
                        </div>
                        <ProgressBar
                          value={run.conviction}
                          color={
                            run.conviction >= 70
                              ? 'var(--success)'
                              : run.conviction >= 45
                                ? 'var(--gold-1)'
                                : 'var(--danger)'
                          }
                          height={5}
                          ariaLabel={`Conviction ${run.conviction}`}
                        />
                      </div>
                    ) : null}
                    <Badge tone={statusTone(run.status)} className="flex-none text-[10px]">
                      {statusLabel(run.status)}
                    </Badge>
                    {run.conviction != null ? (
                      <Badge
                        tone={convictionTone(run.conviction)}
                        className="flex-none text-[10px] sm:hidden"
                      >
                        {run.conviction}
                      </Badge>
                    ) : null}
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
