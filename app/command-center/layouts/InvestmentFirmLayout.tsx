import { Briefcase, Coins, Radar, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { KpiTile } from '@/components/dashboard/KpiTile';
import type { NextBestAction } from '@/components/dashboard/EarnNextBestActions';
import type { ChainOfTrustStanding } from '@/components/dashboard/ChainOfTrustStrip';
import { MemberDashboardChrome } from './MemberDashboardChrome';
import type { InvestmentFirmData } from '@/lib/queries/dashboard';

function money(n: number): string {
  if (!n) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

const STAGE_TONE: Record<string, 'azure' | 'gold' | 'success' | 'warning' | 'neutral'> = {
  sourcing: 'neutral',
  screening: 'neutral',
  diligence: 'azure',
  ic: 'warning',
  closing: 'gold',
  closed: 'success'
};

function buildActions(data: InvestmentFirmData): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const stuckDiligence = data.deals.find((d) => d.stage === 'diligence');
  if (stuckDiligence) {
    actions.push({
      id: 'advance-diligence',
      title: `Advance ${stuckDiligence.name}`,
      context: 'Diligence is the slowest stage — unblock the next milestone.',
      cta: 'Open in Pipeline',
      href: '/pipeline',
      icon: Radar as LucideIcon,
      tone: 'azure'
    });
  }
  if (data.kpis.capitalDeployed === 0) {
    actions.push({
      id: 'log-allocations',
      title: 'Log this month’s allocations',
      context: 'Track committed capital so the Chain of Trust reflects the work.',
      cta: 'Open Pipeline',
      href: '/pipeline',
      icon: Coins as LucideIcon,
      tone: 'success'
    });
  }
  if (data.capitalProviders.length < 3) {
    actions.push({
      id: 'expand-lps',
      title: 'Expand your LP roster',
      context: 'Connect more capital providers so Earn can match deals faster.',
      cta: 'Open Connections',
      href: '/connections',
      icon: Users as LucideIcon,
      tone: 'azure'
    });
  }
  actions.push({
    id: 'ask-earn',
    title: 'Ask Earn for an IC briefing',
    context: 'Get a one-page summary of where every active deal sits.',
    cta: 'Open Ask Earn',
    href: '/ask-earn',
    icon: Sparkles as LucideIcon,
    tone: 'gold'
  });
  return actions.slice(0, 5);
}

export interface InvestmentFirmLayoutProps {
  displayName: string;
  position: string;
  trust: ChainOfTrustStanding;
  load: { data: InvestmentFirmData | null; empty: boolean; error?: string };
}

export function InvestmentFirmLayout({
  displayName,
  position,
  trust,
  load
}: InvestmentFirmLayoutProps) {
  if (load.error) {
    return (
      <MemberDashboardChrome
        displayName={displayName}
        position={position}
        trust={trust}
        actions={[]}
      >
        <Card className="p-8 text-center">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-warning">
            Dashboard error
          </p>
          <p className="mt-2 text-[13px] text-fg-2">{load.error}</p>
          <p className="mt-1 text-[11.5px] text-fg-4">Refresh to retry, or open Ask Earn.</p>
        </Card>
      </MemberDashboardChrome>
    );
  }

  const data = load.data;
  const actions = data ? buildActions(data) : [];

  return (
    <MemberDashboardChrome
      displayName={displayName}
      position={position}
      trust={trust}
      actions={actions}
    >
      <div className="flex flex-col gap-[18px]">
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Pipeline value"
            value={money(data?.kpis.pipelineValue ?? 0)}
            sub="All active opportunities"
            icon={Briefcase}
            tone="azure"
          />
          <KpiTile
            label="Active deals"
            value={String(data?.kpis.activeDeals ?? 0)}
            sub="Across all stages"
            icon={Radar}
            tone="azure"
          />
          <KpiTile
            label="Capital deployed"
            value={money(data?.kpis.capitalDeployed ?? 0)}
            sub="Accepted + funded"
            icon={Coins}
            tone="success"
          />
          <KpiTile
            label="Sourced last 30d"
            value={String(data?.kpis.sourcingThisMonth ?? 0)}
            sub="New deals opened"
            icon={Sparkles}
            tone="gold"
          />
        </div>

        <Card>
          <SectionTitle eyebrow="Pipeline" title="Active deals" className="mb-3" />
          {data && data.deals.length > 0 ? (
            <ul className="divide-y divide-hairline">
              {data.deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-fg-1">{d.name}</p>
                    <p className="text-[11px] text-fg-4">{money(d.amount ?? 0)}</p>
                  </div>
                  <Badge tone={STAGE_TONE[d.stage] ?? 'neutral'} className="text-[10px] uppercase">
                    {d.stage}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint
              title="No deals yet"
              body="Open Pipeline to add your first opportunity."
              href="/pipeline"
              cta="Open Pipeline"
            />
          )}
        </Card>

        <div className="grid gap-[18px] lg:grid-cols-2">
          <Card>
            <SectionTitle eyebrow="Capital" title="LP roster" className="mb-3" />
            {data && data.capitalProviders.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.capitalProviders.map((cp) => (
                  <li
                    key={cp.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{cp.name}</span>
                    <Badge tone="azure" className="text-[10px]">
                      LP
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No LPs mapped"
                body="Connect capital providers so Earn can match them to deals."
                href="/connections"
                cta="Open Connections"
              />
            )}
          </Card>

          <Card>
            <SectionTitle eyebrow="Co-investors" title="Active partnerships" className="mb-3" />
            {data && data.partnerships.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.partnerships.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{p.counterparty}</span>
                    <Badge tone="neutral" className="text-[10px] uppercase">
                      {p.stage ?? '—'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No partnerships yet"
                body="Add co-investors to keep capital warm."
                href="/connections"
                cta="Add partnerships"
              />
            )}
          </Card>
        </div>
      </div>
    </MemberDashboardChrome>
  );
}

function EmptyHint({
  title,
  body,
  href,
  cta
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-surface-1 p-5 text-center">
      <p className="text-[12.5px] font-medium text-fg-2">{title}</p>
      <p className="mt-1 text-[11.5px] text-fg-4">{body}</p>
      <a
        href={href}
        className="mt-3 inline-flex text-[11.5px] font-semibold text-azure-1 hover:underline"
      >
        {cta} →
      </a>
    </div>
  );
}
