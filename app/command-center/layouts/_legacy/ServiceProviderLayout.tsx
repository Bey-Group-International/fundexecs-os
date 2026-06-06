import { Inbox, CheckCircle2, Users, Sparkles, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import { KpiTile } from '@/components/dashboard/KpiTile';
import type { NextBestAction } from '@/components/dashboard/EarnNextBestActions';
import type { ChainOfTrustStanding } from '@/components/dashboard/ChainOfTrustStrip';
import { MemberDashboardChrome } from './MemberDashboardChrome';
import type { ServiceProviderData } from '@/lib/queries/dashboard';

function buildActions(data: ServiceProviderData): NextBestAction[] {
  const actions: NextBestAction[] = [];
  if (data.kpis.demandSignalsToday > 0) {
    actions.push({
      id: 'reply-signals',
      title: 'Reply to today’s inbound signals',
      context: `${data.kpis.demandSignalsToday} new interactions — respond before they cool.`,
      cta: 'Open Connections',
      href: '/connections',
      icon: Inbox as LucideIcon,
      tone: 'azure'
    });
  }
  if (data.engagements.some((e) => e.stage === 'intake')) {
    actions.push({
      id: 'qualify-intake',
      title: 'Qualify your intake queue',
      context: 'Move intake engagements to active or politely decline.',
      cta: 'Open Pipeline',
      href: '/pipeline',
      icon: CheckCircle2 as LucideIcon,
      tone: 'warning'
    });
  }
  if (data.idealClients.length < 3) {
    actions.push({
      id: 'add-clients',
      title: 'Add ideal-client targets',
      context: 'A focused target list lets Earn surface high-fit signals first.',
      cta: 'Open Connections',
      href: '/connections',
      icon: Users as LucideIcon,
      tone: 'azure'
    });
  }
  actions.push({
    id: 'ask-earn',
    title: 'Ask Earn to draft an outreach',
    context: 'Get a tailored note to the warmest unread prospect.',
    cta: 'Open Ask Earn',
    href: '/ask-earn',
    icon: Sparkles as LucideIcon,
    tone: 'gold'
  });
  return actions.slice(0, 5);
}

export interface ServiceProviderLayoutProps {
  displayName: string;
  position: string;
  trust: ChainOfTrustStanding;
  load: { data: ServiceProviderData | null; empty: boolean; error?: string };
}

export function ServiceProviderLayout({
  displayName,
  position,
  trust,
  load
}: ServiceProviderLayoutProps) {
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
            label="Inbound active"
            value={String(data?.kpis.inboundActive ?? 0)}
            sub="Open engagements"
            icon={Inbox}
            tone="azure"
          />
          <KpiTile
            label="Closed last 30d"
            value={String(data?.kpis.closedThisMonth ?? 0)}
            sub="Wins booked"
            icon={CheckCircle2}
            tone="success"
          />
          <KpiTile
            label="Ideal clients"
            value={String(data?.kpis.idealClientMatches ?? 0)}
            sub="High-fit contacts"
            icon={Users}
            tone="azure"
          />
          <KpiTile
            label="Signals today"
            value={String(data?.kpis.demandSignalsToday ?? 0)}
            sub="Inbound interactions"
            icon={Sparkles}
            tone="gold"
          />
        </div>

        <Card>
          <SectionTitle eyebrow="Engagements" title="Inbound pipeline" className="mb-3" />
          {data && data.engagements.length > 0 ? (
            <ul className="divide-y divide-hairline">
              {data.engagements.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                  <p className="truncate text-[13px] font-medium text-fg-1">{e.name}</p>
                  <Badge
                    tone={
                      e.status === 'won' ? 'success' : e.stage === 'intake' ? 'warning' : 'azure'
                    }
                    className="text-[10px] uppercase"
                  >
                    {e.stage}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint
              title="No inbound engagements yet"
              body="As prospects reach out, they’ll land here."
              href="/connections"
              cta="Open Connections"
            />
          )}
        </Card>

        <div className="grid gap-[18px] lg:grid-cols-2">
          <Card>
            <SectionTitle eyebrow="Targets" title="Ideal clients" className="mb-3" />
            {data && data.idealClients.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.idealClients.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{c.full_name}</span>
                    <span className="text-[10.5px] text-fg-5">{c.company ?? '—'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No targets yet"
                body="Add the firms you most want to serve."
                href="/connections"
                cta="Add targets"
              />
            )}
          </Card>

          <Card>
            <SectionTitle eyebrow="Signals" title="Recent demand" className="mb-3" />
            {data && data.demandSignals.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.demandSignals.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{s.subject ?? s.type}</span>
                    <Badge tone="neutral" className="text-[10px] uppercase">
                      {s.type ?? 'signal'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="Quiet so far today"
                body="Connect Gmail or Calendly to surface inbound signals."
                href="/integrations"
                cta="Open Integrations"
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
