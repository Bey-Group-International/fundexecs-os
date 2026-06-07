import { Rocket, Send, FileText, Users, Sparkles, type LucideIcon } from 'lucide-react';
import { Badge, Card, ProgressBar, SectionTitle } from '@/components/ui';
import { KpiTile } from '@/components/dashboard/KpiTile';
import type { NextBestAction } from '@/components/dashboard/EarnNextBestActions';
import type { ChainOfTrustStanding } from '@/components/dashboard/ChainOfTrustStrip';
import { MemberDashboardChrome } from './MemberDashboardChrome';
import type { StartupData } from '@/lib/queries/dashboard';

function money(n: number): string {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function buildActions(data: StartupData): NextBestAction[] {
  const actions: NextBestAction[] = [];
  const pendingIntros = data.warmIntros.filter((i) => i.status === 'requested');
  if (pendingIntros[0]) {
    actions.push({
      id: 'follow-up-intro',
      title: `Follow up: ${pendingIntros[0].counterparty}`,
      context: 'A warm intro is pending — nudge before it cools.',
      cta: 'Open Connections',
      href: '/connections',
      icon: Send as LucideIcon,
      tone: 'azure'
    });
  }
  if (data.raise.progressPct > 0 && data.raise.progressPct < 50) {
    actions.push({
      id: 'add-investors',
      title: 'Add investor targets',
      context: `Raise is at ${data.raise.progressPct}% — broaden the funnel.`,
      cta: 'Open Connections',
      href: '/connections',
      icon: Users as LucideIcon,
      tone: 'warning'
    });
  }
  if (data.materials.total === 0 || data.materials.completed < data.materials.total) {
    actions.push({
      id: 'materials-check',
      title: 'Finish your raise materials',
      context: 'Deck, data room, and the FAQ — don’t walk into the meeting half-prepared.',
      cta: 'Open Strategy',
      href: '/strategy',
      icon: FileText as LucideIcon,
      tone: 'azure'
    });
  }
  actions.push({
    id: 'ask-earn-pitch',
    title: 'Ask Earn to pressure-test your pitch',
    context: 'Five minutes against the institutional checklist.',
    cta: 'Open Ask Earn',
    href: '/ask-earn',
    icon: Sparkles as LucideIcon,
    tone: 'gold'
  });
  return actions.slice(0, 5);
}

export interface StartupLayoutProps {
  displayName: string;
  position: string;
  trust: ChainOfTrustStanding;
  load: { data: StartupData | null; empty: boolean; error?: string };
}

export function StartupLayout({ displayName, position, trust, load }: StartupLayoutProps) {
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
        <Card>
          <SectionTitle
            eyebrow={data?.raise.activeDealName ?? 'Your raise'}
            title="Raise progress"
            className="mb-3"
          />
          {data && (data.raise.targetAmount > 0 || data.raise.raisedAmount > 0) ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                  {money(data.raise.raisedAmount)}
                </span>
                <span className="text-[12.5px] text-fg-4">of {money(data.raise.targetAmount)}</span>
              </div>
              <ProgressBar value={data.raise.progressPct} ariaLabel="Raise progress" />
              <p className="text-[11.5px] text-fg-4">{data.raise.progressPct}% committed</p>
            </div>
          ) : (
            <EmptyHint
              title="No active raise yet"
              body="Open the Pipeline to set up your round."
              href="/pipeline"
              cta="Open Pipeline"
            />
          )}
        </Card>

        <div className="grid gap-3.5 sm:grid-cols-3">
          <KpiTile
            label="Warm intros"
            value={String((data?.warmIntros ?? []).filter((i) => i.status === 'requested').length)}
            sub="Pending requests"
            icon={Send}
            tone="azure"
          />
          <KpiTile
            label="Investor targets"
            value={String(data?.investorTargets.length ?? 0)}
            sub="On your shortlist"
            icon={Users}
            tone="azure"
          />
          <KpiTile
            label="Materials"
            value={`${data?.materials.completed ?? 0}/${data?.materials.total ?? 0}`}
            sub="Tasks complete"
            icon={FileText}
            tone="success"
          />
        </div>

        <div className="grid gap-[18px] lg:grid-cols-2">
          <Card>
            <SectionTitle eyebrow="Network" title="Warm intros" className="mb-3" />
            {data && data.warmIntros.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.warmIntros.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{i.counterparty}</span>
                    <Badge
                      tone={i.status === 'requested' ? 'warning' : 'azure'}
                      className="text-[10px] uppercase"
                    >
                      {i.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No warm intros yet"
                body="Request your first warm intro from Connections."
                href="/connections"
                cta="Open Connections"
              />
            )}
          </Card>
          <Card>
            <SectionTitle eyebrow="Investors" title="Target list" className="mb-3" />
            {data && data.investorTargets.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {data.investorTargets.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-lg px-1 py-1.5"
                  >
                    <span className="truncate text-[12.5px] text-fg-2">{c.name}</span>
                    <Rocket size={12} strokeWidth={2} className="text-azure-1" aria-hidden />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint
                title="No targets yet"
                body="Add the funds you most want to bring on."
                href="/connections"
                cta="Add investor targets"
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
