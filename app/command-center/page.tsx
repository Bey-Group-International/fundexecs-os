import type { Metadata } from 'next';
import {
  TrendingUp,
  Handshake,
  Banknote,
  Target,
  ArrowRight,
  Sparkles,
  Zap,
  Eye,
  Link2,
  type LucideIcon
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Badge, Button, Card, ProgressBar, SectionTitle, type BadgeTone } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getCommandCenterData, type CommandCenterData } from '@/lib/queries/command-center';

export const metadata: Metadata = { title: 'Command Center' };

interface Kpi {
  label: string;
  value: string;
  delta: string;
  sub: string;
  icon: LucideIcon;
  tone: BadgeTone;
}

const TONE_HEX: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount}`;
}

function buildKpis(data: CommandCenterData): Kpi[] {
  return [
    {
      label: 'Active deals',
      value: String(data.activeDealsCount),
      delta: 'live',
      sub: 'in pipeline',
      icon: TrendingUp,
      tone: 'success'
    },
    {
      label: 'Capital in motion',
      value: formatCurrency(data.capitalInMotion),
      delta: 'total',
      sub: `across ${data.capitalDealCount} deals`,
      icon: Banknote,
      tone: 'gold'
    },
    {
      label: 'Hot relationships',
      value: String(data.hotRelationshipsCount),
      delta: 'hot',
      sub: `${data.warmRelationshipsThisWeek} warm this week`,
      icon: Handshake,
      tone: 'azure'
    },
    {
      label: 'Warm connections',
      value: String(data.topWarmConnections.length),
      delta: 'top',
      sub: 'highest warmth',
      icon: Target,
      tone: 'info'
    }
  ];
}

function dealTone(strength: number): BadgeTone {
  if (strength >= 80) return 'success';
  if (strength >= 50) return 'gold';
  return 'azure';
}

interface Synergy {
  icon: LucideIcon;
  tone: BadgeTone;
  title: string;
  detail: string;
  time: string;
}

const SYNERGIES: Synergy[] = [
  {
    icon: Zap,
    tone: 'gold',
    title: 'Meridian family office matched to Series A',
    detail: 'Strategic fit 92% · routed to Capital Connector',
    time: '4m'
  },
  {
    icon: Eye,
    tone: 'azure',
    title: 'Granite opened your deck twice',
    detail: 'Earn suggests a follow-up message',
    time: '1h'
  },
  {
    icon: Link2,
    tone: 'info',
    title: 'Sterling Private Credit can fund Cedar',
    detail: 'Unitranche term match found',
    time: '3h'
  }
];

function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  return (
    <Card clickable className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-fg-3">{kpi.label}</span>
        <span style={{ color: TONE_HEX[kpi.tone] }}>
          <Icon size={16} strokeWidth={1.9} aria-hidden />
        </span>
      </div>
      <div className="mt-3 text-[27px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
        {kpi.value}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Badge tone={kpi.tone} className="px-2 py-0.5 text-[10.5px]">
          {kpi.delta}
        </Badge>
        <span className="truncate text-[11.5px] text-fg-5">{kpi.sub}</span>
      </div>
    </Card>
  );
}

function EarnBriefing({ data }: { data: CommandCenterData }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-4 border-b border-hairline bg-[linear-gradient(105deg,rgba(247,201,72,0.11),rgba(247,201,72,0.02)_46%,transparent_72%)] px-5 py-[18px]">
        <span className="inline-flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-gold-1 to-gold-2 text-lg font-bold text-[#070b14]">
          E
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15.5px] font-semibold tracking-[-0.015em] text-fg-1">
              Good morning.
            </span>
            <Badge tone="gold" className="px-1.5 py-px text-[9.5px]">
              Earn
            </Badge>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">
            <span className="font-semibold text-fg-2">Earnest Fundmaker</span>, your private-market
            assistant, is monitoring{' '}
            <span className="font-semibold text-gold-1">{data.activeDealsCount} deals</span> and{' '}
            <span className="font-semibold text-gold-1">
              {data.hotRelationshipsCount} hot relationships
            </span>{' '}
            across your network.
          </p>
        </div>
        <Button variant="gold" icon={Sparkles} className="flex-none">
          Ask Earn
        </Button>
      </div>
    </Card>
  );
}

function DealFlow({ data }: { data: CommandCenterData }) {
  return (
    <Card>
      <SectionTitle
        eyebrow={`${data.activeDealsCount} active`}
        title="Deal flow"
        action={
          <Button variant="ghost" size="sm" iconRight={ArrowRight}>
            Pipeline
          </Button>
        }
      />
      {data.recentDeals.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-5">No deals yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr] gap-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            <span>Deal</span>
            <span>Stage</span>
            <span>Size</span>
            <span>Status</span>
          </div>
          <div className="my-2 h-px bg-hairline" />
          <div className="flex flex-col gap-0.5">
            {data.recentDeals.map((d) => {
              const trust = Math.min(100, Math.max(0, (d.amount ?? 0) / 1_000_000));
              const tone = dealTone(trust);
              return (
                <div
                  key={d.id}
                  className="grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr] items-center gap-2 rounded-lg px-1.5 py-2.5 transition hover:bg-surface-1"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{d.name}</div>
                    <div className="text-[11px] text-fg-5">{d.status}</div>
                  </div>
                  <span className="text-xs text-fg-3">{d.stage}</span>
                  <span className="text-[12.5px] font-medium tabular-nums text-fg-2">
                    {d.amount != null ? formatCurrency(d.amount) : '—'}
                  </span>
                  <div className="flex items-center gap-2">
                    <ProgressBar
                      value={trust}
                      color={TONE_HEX[tone]}
                      height={5}
                      className="flex-1"
                    />
                    <span className="w-7 text-right text-[11px] tabular-nums text-fg-4">
                      {Math.round(trust)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

function SynergyFeed() {
  return (
    <Card>
      <SectionTitle
        title="Synergy alerts"
        action={
          <Badge tone="gold" dot pulse>
            Live
          </Badge>
        }
      />
      <div className="flex flex-col gap-2.5">
        {SYNERGIES.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              className="flex items-start gap-3 rounded-xl p-2.5 hover:bg-surface-1"
            >
              <span
                className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border"
                style={{
                  color: TONE_HEX[s.tone],
                  background: `var(--${s.tone}-soft, var(--surface-2))`,
                  borderColor: `var(--${s.tone}-line, var(--border))`
                }}
              >
                <Icon size={15} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-fg-1">{s.title}</div>
                <div className="mt-0.5 text-[11.5px] text-fg-4">{s.detail}</div>
              </div>
              <span className="font-mono text-[10.5px] text-fg-5">{s.time}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WarmConnectionsPanel({ data }: { data: CommandCenterData }) {
  return (
    <Card>
      <SectionTitle
        eyebrow="Relationship intelligence"
        title="Warm connections"
        action={
          <Button variant="ghost" size="sm" iconRight={ArrowRight}>
            View all
          </Button>
        }
      />
      {data.topWarmConnections.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-5">No connections yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.topWarmConnections.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-xl px-1.5 py-2 hover:bg-surface-1"
            >
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-fg-1">{c.name}</div>
                <div className="truncate text-[11px] text-fg-5">
                  {c.company ?? 'Unknown company'}
                </div>
              </div>
              <Badge tone={dealTone(c.strength)} className="px-2 py-0.5 text-[10.5px] tabular-nums">
                {c.strength}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function NoOrgState() {
  return (
    <AppShell title="Command Center" subtitle="Your private-market briefing">
      <Card className="p-10 text-center">
        <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
        <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
          You are not a member of an organization yet. Once you join or create one, your deal flow
          and relationship intelligence will appear here.
        </p>
      </Card>
    </AppShell>
  );
}

export default async function CommandCenterPage() {
  const org = await getActiveOrg();

  if (!org) {
    return <NoOrgState />;
  }

  const data = await getCommandCenterData(org.orgId);
  const kpis = buildKpis(data);

  return (
    <AppShell title="Command Center" subtitle="Your private-market briefing">
      <div className="flex flex-col gap-[18px]">
        <EarnBriefing data={data} />

        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {kpis.map((k) => (
            <KpiCard key={k.label} kpi={k} />
          ))}
        </div>

        <div className="grid gap-[18px] lg:grid-cols-[1.5fr_1fr]">
          <DealFlow data={data} />
          <div className="flex flex-col gap-[18px]">
            <SynergyFeed />
            <WarmConnectionsPanel data={data} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
