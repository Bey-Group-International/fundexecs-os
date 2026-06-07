import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Briefcase, Target, TrendingUp, Layers } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getPipelineData, type PipelineDeal } from '@/lib/queries/pipeline';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { formatCompactUsd, fitTone, stageColor } from './ui';

/** A Next Link styled as a secondary Button (Button is a native <button>, so
 *  we render a matching anchor for navigation CTAs). */
function LinkButton({
  href,
  children,
  variant = 'secondary'
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition';
  const tone =
    variant === 'primary'
      ? 'bg-[linear-gradient(135deg,#3B74F0,#2152D8)] text-white border border-transparent shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] hover:brightness-110'
      : 'bg-surface-2 text-fg-1 border border-hairline hover:bg-surface-3';
  return (
    <Link href={href} className={`${base} ${tone}`}>
      {children}
      <ArrowUpRight size={16} strokeWidth={1.9} aria-hidden />
    </Link>
  );
}

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Deal Desk' },
  description: 'The investment-opportunity desk — source, screen, decide, and deploy.'
};

const SUBTITLE = 'Source, screen, decide — your live opportunity desk';

function NoOrg({ identity }: { identity: Awaited<ReturnType<typeof getShellIdentity>> }) {
  return (
    <AppShell identity={identity} title="Deal Desk" subtitle={SUBTITLE}>
      <Card className="p-10 text-center">
        <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
        <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
          Join or create an organization to start sourcing, screening, and deciding on deals from a
          single desk.
        </p>
      </Card>
    </AppShell>
  );
}

export default async function DealDeskPage() {
  const org = await getActiveOrg();
  const identity = await getShellIdentity();
  if (!org) return <NoOrg identity={identity} />;

  const data = await getPipelineData(org.orgId);

  // Top live deals across every stage, ranked by thesis-fit then size.
  const liveDeals: PipelineDeal[] = data.stages
    .flatMap((s) => s.deals.map((d) => ({ deal: d, stageLabel: s.label })))
    .sort((a, b) => b.deal.fit - a.deal.fit || (b.deal.amount ?? 0) - (a.deal.amount ?? 0))
    .slice(0, 8)
    .map((x) => x.deal);

  const stageLabelByDealId = new Map<string, string>();
  for (const s of data.stages) for (const d of s.deals) stageLabelByDealId.set(d.id, s.label);

  const peakStageCount = data.stages.reduce((m, s) => Math.max(m, s.deals.length), 0);
  const avgFit = data.totalDeals
    ? Math.round(
        data.stages.flatMap((s) => s.deals).reduce((sum, d) => sum + d.fit, 0) / data.totalDeals
      )
    : 0;

  const kpis = [
    {
      label: 'Pipeline value',
      value: formatCompactUsd(data.pipelineValue),
      icon: Briefcase,
      hint: `${data.totalDeals} ${data.totalDeals === 1 ? 'deal' : 'deals'} in play`
    },
    {
      label: 'Soft-circled',
      value: formatCompactUsd(data.softCircled),
      icon: Layers,
      hint: 'Indicated interest'
    },
    {
      label: 'Committed',
      value: formatCompactUsd(data.committed),
      icon: TrendingUp,
      hint: `${data.conversionPct}% conversion`
    },
    {
      label: 'Avg thesis-fit',
      value: `${avgFit}`,
      icon: Target,
      hint: 'Across live deals'
    }
  ];

  return (
    <AppShell identity={identity} title="Deal Desk" subtitle={SUBTITLE}>
      <div className="flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionTitle eyebrow="Deal execution" title="The desk" className="mb-0" />
          <LinkButton href="/pipeline">Open pipeline board</LinkButton>
        </div>

        {/* Hero KPI strip — bold, gradient-washed, tabular figures. */}
        <Card className="grid gap-px overflow-hidden bg-hairline p-0 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map(({ label, value, icon: Icon, hint }) => (
            <div
              key={label}
              className="bg-[linear-gradient(150deg,rgba(91,141,239,0.06),transparent_62%)] bg-surface-1 p-[18px]"
            >
              <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                <Icon size={13} strokeWidth={2} aria-hidden />
                {label}
              </div>
              <div className="mt-2.5 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                {value}
              </div>
              <div className="mt-1 text-[11.5px] text-fg-4">{hint}</div>
            </div>
          ))}
        </Card>

        {data.totalDeals === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-surface-2">
              <Briefcase size={20} strokeWidth={1.8} className="text-fg-3" aria-hidden />
            </span>
            <h3 className="text-[15px] font-semibold text-fg-1">No deals on the desk yet</h3>
            <p className="max-w-md text-[12.5px] leading-relaxed text-fg-4">
              When opportunities land in your pipeline they surface here — ranked by thesis-fit,
              with their funnel stage and live capital. Add your first deal from the pipeline board.
            </p>
            <LinkButton href="/pipeline" variant="primary">
              Open pipeline board
            </LinkButton>
          </Card>
        ) : (
          <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Live deals register — ranked by thesis-fit. */}
            <div className="flex flex-col gap-2.5">
              <SectionTitle eyebrow="Ranked by thesis-fit" title="Live deals" className="mb-0" />
              {liveDeals.map((d) => {
                const tone = fitTone(d.fit);
                return (
                  <Link key={d.id} href="/pipeline" className="block">
                    <Card clickable className="flex items-center gap-4 p-4">
                      <div
                        className="flex h-11 w-11 flex-none flex-col items-center justify-center rounded-xl border tabular-nums"
                        style={{
                          color: 'var(--gold-1)',
                          borderColor: 'var(--gold-line)',
                          background: 'var(--gold-soft)'
                        }}
                      >
                        <span className="text-[15px] font-semibold leading-none">{d.fit}</span>
                        <span className="mt-0.5 text-[8px] uppercase tracking-wide text-fg-4">
                          fit
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold text-fg-1">
                          {d.name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-4">
                          <Badge tone={tone} className="text-[10px]">
                            {stageLabelByDealId.get(d.id) ?? d.stage}
                          </Badge>
                          <span>{d.note}</span>
                          {d.diligenceRuns.length > 0 ? (
                            <span className="tabular-nums">
                              {d.diligenceRuns.length}{' '}
                              {d.diligenceRuns.length === 1 ? 'IC run' : 'IC runs'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex-none text-right">
                        <div className="text-[13.5px] font-semibold tabular-nums text-fg-1">
                          {d.amount != null ? formatCompactUsd(d.amount) : '—'}
                        </div>
                        {d.allocations.length > 0 ? (
                          <div className="mt-0.5 text-[10.5px] text-fg-4">
                            {d.allocations.length}{' '}
                            {d.allocations.length === 1 ? 'allocation' : 'allocations'}
                          </div>
                        ) : null}
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>

            {/* Funnel rail — stage distribution with proportional bars. */}
            <Card className="h-fit p-[18px]">
              <div className="mb-3.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Formation funnel
              </div>
              <div className="flex flex-col gap-3">
                {data.stages.map((s, i) => {
                  const color = stageColor(i, data.stages.length);
                  const pct = peakStageCount ? (s.deals.length / peakStageCount) * 100 : 0;
                  return (
                    <div key={s.key}>
                      <div className="flex items-baseline justify-between text-[11.5px]">
                        <span className="font-medium text-fg-2">{s.label}</span>
                        <span className="tabular-nums text-fg-4">{s.deals.length}</span>
                      </div>
                      <ProgressBar
                        value={pct}
                        color={color}
                        height={6}
                        className="mt-1.5"
                        ariaLabel={`${s.deals.length} deals in ${s.label}`}
                      />
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
