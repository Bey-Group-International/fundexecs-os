import { Coins, Eye, Radar, Users, Sparkles, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { DealTrustChipFromRefs } from '@/components/dashboard/DealTrustChip';
import type { NextBestAction } from '@/components/dashboard/EarnNextBestActions';
import type { ChainOfTrustStanding } from '@/components/dashboard/ChainOfTrustStrip';
import { MemberDashboardChrome } from './MemberDashboardChrome';
import type { IndividualInvestorData } from '@/lib/queries/dashboard';

function money(n: number): string {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function buildActions(data: IndividualInvestorData): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const diligence = data.deals.find((d) => d.stage === 'diligence');
  if (diligence) {
    actions.push({
      id: 'finish-diligence',
      title: `Decide on ${diligence.name}`,
      context: 'A diligence position is open — commit, pass, or hold.',
      cta: 'Open Pipeline',
      href: '/pipeline',
      icon: Radar as LucideIcon,
      tone: 'azure'
    });
  }
  if (data.kpis.allocationsAmount === 0) {
    actions.push({
      id: 'log-allocation',
      title: 'Log your first allocation',
      context: 'Track what you’ve committed so Earn can map your portfolio.',
      cta: 'Open Pipeline',
      href: '/pipeline',
      icon: Coins as LucideIcon,
      tone: 'success'
    });
  }
  if (data.watchlist.length > 0) {
    actions.push({
      id: 'watchlist',
      title: 'Review your watchlist',
      context: `${data.watchlist.length} opportunity${data.watchlist.length === 1 ? '' : 'ies'} matched your thesis.`,
      cta: 'Open Connections',
      href: '/connections',
      icon: Eye as LucideIcon,
      tone: 'azure'
    });
  }
  if (data.syndicateContacts.length < 3) {
    actions.push({
      id: 'syndicate',
      title: 'Build your syndicate',
      context: 'Add co-investors so you can split allocations confidently.',
      cta: 'Open Connections',
      href: '/connections',
      icon: Users as LucideIcon,
      tone: 'azure'
    });
  }
  actions.push({
    id: 'ask-earn',
    title: 'Ask Earn for a portfolio review',
    context: 'Five-minute health check of your current positions.',
    cta: 'Open Ask Earn',
    href: '/ask-earn',
    icon: Sparkles as LucideIcon,
    tone: 'gold'
  });
  return actions.slice(0, 5);
}

export interface IndividualInvestorLayoutProps {
  displayName: string;
  position: string;
  trust: ChainOfTrustStanding;
  load: { data: IndividualInvestorData | null; empty: boolean; error?: string };
}

export function IndividualInvestorLayout({
  displayName,
  position,
  trust,
  load
}: IndividualInvestorLayoutProps) {
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
            label="Active deals"
            value={String(data?.kpis.activeDeals ?? 0)}
            sub="Scout / diligence / open"
            icon={Radar}
            tone="azure"
          />
          <KpiTile
            label="Allocations"
            value={money(data?.kpis.allocationsAmount ?? 0)}
            sub="Committed across positions"
            icon={Coins}
            tone="success"
          />
          <KpiTile
            label="Syndicate"
            value={String(data?.kpis.syndicateActivity ?? 0)}
            sub="Co-investors"
            icon={Users}
            tone="azure"
          />
          <KpiTile
            label="Watchlist"
            value={String(data?.kpis.watchlistCount ?? 0)}
            sub="Tracked opportunities"
            icon={Eye}
            tone="gold"
          />
        </div>

        <Card>
          <SectionTitle eyebrow="Pipeline" title="Active positions" className="mb-3" />
          {data && data.deals.length > 0 ? (
            <ul className="divide-y divide-hairline">
              {data.deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-fg-1">{d.name}</p>
                    <p className="text-[11px] text-fg-4">{money(d.amount ?? 0)}</p>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <DealTrustChipFromRefs
                      dealId={d.id}
                      dealName={d.name}
                      refs={data.dealTrustRefs}
                    />
                    <Badge
                      tone={d.status === 'passed' ? 'neutral' : 'azure'}
                      className="text-[10px] uppercase"
                    >
                      {d.stage}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint
              title="No deals yet"
              body="Track your first opportunity in Pipeline."
              href="/pipeline"
              cta="Open Pipeline"
            />
          )}
        </Card>

        <div className="grid gap-[18px] lg:grid-cols-2">
          <Card>
            <SectionTitle eyebrow="Capital" title="Allocations" className="mb-3" />
            {data && data.allocations.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.allocations.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{a.dealName}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11.5px] tabular-nums text-fg-3">
                        {money(a.amount ?? 0)}
                      </span>
                      <Badge
                        tone={
                          a.status === 'accepted' || a.status === 'funded' ? 'success' : 'neutral'
                        }
                        className="text-[10px] uppercase"
                      >
                        {a.status ?? 'proposed'}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No allocations yet"
                body="Log a check to start your portfolio history."
                href="/pipeline"
                cta="Open Pipeline"
              />
            )}
          </Card>

          <Card>
            <SectionTitle eyebrow="Watchlist" title="Tracked opportunities" className="mb-3" />
            {data && data.watchlist.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {data.watchlist.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-lg border border-hairline bg-surface-1 px-2.5 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12px] text-fg-2">{o.rationale}</p>
                      <Badge tone="azure" className="text-[10px] tabular-nums">
                        {Math.round(o.score ?? 0)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="Watchlist is empty"
                body="Tag opportunities to revisit later."
                href="/connections"
                cta="Open Connections"
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
