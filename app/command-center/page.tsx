import type { Metadata } from 'next';
import {
  TrendingUp,
  CalendarRange,
  Handshake,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  Zap,
  Eye,
  Link2,
  Rocket,
  Lightbulb,
  type LucideIcon
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Badge, Button, Card, ProgressBar, SectionTitle, type BadgeTone } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { TONE_HEX } from '@/components/screens/tone';
import { getActiveOrg } from '@/lib/queries/org';
import { getCommandCenterData, type CommandCenterData } from '@/lib/queries/command-center';
import { Sparkline } from './Sparkline';

export const metadata: Metadata = { title: 'Command Center' };

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount}`;
}

// ── KPIs ────────────────────────────────────────────────────────────────────

interface Kpi {
  label: string;
  value: string;
  icon: LucideIcon;
  delta: string;
  deltaTone: BadgeTone;
  sub: string;
  spark: number[];
  sparkTone: BadgeTone;
}

function buildKpis(data: CommandCenterData): Kpi[] {
  return [
    {
      label: 'Capital deployed',
      value: formatCurrency(data.capitalInMotion),
      icon: CalendarRange,
      delta: '+12.4%',
      deltaTone: 'success',
      sub: `across ${data.activeDealsCount} active deals`,
      spark: [8, 10, 9, 12, 11, 15, 14, 18],
      sparkTone: 'success'
    },
    {
      label: 'Pipeline value',
      value: '$182M',
      icon: TrendingUp,
      delta: `+${data.activeDealsCount} deals`,
      deltaTone: 'azure',
      sub: `${data.capitalDealCount} in chain of trust`,
      spark: [6, 7, 9, 8, 11, 13, 14, 17],
      sparkTone: 'azure'
    },
    {
      label: 'LP commitments',
      value: '$41.2M',
      icon: Handshake,
      delta: '72% of target',
      deltaTone: 'gold',
      sub: 'Fund II · $57M target',
      spark: [4, 6, 7, 9, 10, 12, 13, 15],
      sparkTone: 'gold'
    },
    {
      label: 'Trust score',
      value: '88',
      icon: ShieldCheck,
      delta: 'Institutional',
      deltaTone: 'info',
      sub: '4-layer verified',
      spark: [10, 11, 11, 13, 14, 15, 16, 18],
      sparkTone: 'info'
    }
  ];
}

function dealTone(strength: number): BadgeTone {
  if (strength >= 80) return 'success';
  if (strength >= 50) return 'azure';
  return 'gold';
}

// ── Presentational data (no backing table) ───────────────────────────────────

interface Priority {
  rank: number;
  icon: LucideIcon;
  tone: BadgeTone;
  title: string;
  detail: string;
  impact: string;
  impactTone: BadgeTone;
  brain: string;
  action: string;
}

const PRIORITIES: Priority[] = [
  {
    rank: 1,
    icon: Rocket,
    tone: 'azure',
    title: 'Close Atlas Manufacturing',
    detail: 'Proof of work is the only open layer · $32M',
    impact: '+$32M deployed',
    impactTone: 'success',
    brain: 'Capital Connector',
    action: 'Close'
  },
  {
    rank: 2,
    icon: Eye,
    tone: 'info',
    title: 'Follow up with Granite Endowment',
    detail: 'Opened your deck twice · $10M soft-circled',
    impact: 'Convert $10M',
    impactTone: 'azure',
    brain: 'Investor Relations',
    action: 'Follow up'
  },
  {
    rank: 3,
    icon: Lightbulb,
    tone: 'gold',
    title: 'Advance Cedar roll-up to proof of concept',
    detail: 'Thesis deck + IC review outstanding',
    impact: 'Unblock diligence',
    impactTone: 'gold',
    brain: 'Executive Advisor',
    action: 'Advance'
  }
];

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
    title: 'Meridian FO matched to Series A',
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

// ── Sections ──────────────────────────────────────────────────────────────────

function EarnBriefing({ data }: { data: CommandCenterData }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-4 bg-[linear-gradient(105deg,rgba(247,201,72,0.12),rgba(247,201,72,0.02)_46%,transparent_72%)] px-5 py-[18px]">
        <EarnCoin size={52} glow online className="flex-none" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold tracking-[-0.015em] text-fg-1">
              Good morning, Jordan.
            </span>
            <Badge tone="gold" className="px-1.5 py-px text-[9.5px]">
              Earn
            </Badge>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">
            <span className="font-semibold text-fg-2">Earnest Fundmaker</span>, your private-market
            assistant, is monitoring{' '}
            <span className="font-semibold text-fg-2">{data.activeDealsCount} deals</span>,{' '}
            <span className="font-semibold text-fg-2">
              {data.hotRelationshipsCount} LP conversations
            </span>
            , and 2 flagged items — <span className="font-semibold text-gold-1">3 actions</span>{' '}
            need you today.
          </p>
        </div>
        <Button variant="gold" icon={Sparkles} className="flex-none">
          Ask Earn
        </Button>
      </div>
    </Card>
  );
}

function Priorities() {
  return (
    <section>
      <SectionTitle
        eyebrow="Today's priorities"
        title="Ranked by impact"
        action={
          <Badge tone="gold" className="gap-1 px-2 py-1 text-[10.5px]">
            <Zap size={12} strokeWidth={2.2} aria-hidden />
            +150 XP available
          </Badge>
        }
      />
      <div className="flex flex-col gap-2.5">
        {PRIORITIES.map((p) => {
          const Icon = p.icon;
          return (
            <Card key={p.rank} clickable className="flex items-center gap-4 px-4 py-3">
              <span className="w-3 flex-none font-mono text-[12px] tabular-nums text-fg-4">
                {p.rank}
              </span>
              <span
                className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border"
                style={{
                  color: TONE_HEX[p.tone],
                  background: `var(--${p.tone}-soft, var(--surface-2))`,
                  borderColor: `var(--${p.tone}-line, var(--border))`
                }}
              >
                <Icon size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-fg-1">{p.title}</div>
                <div className="truncate text-[11.5px] text-fg-4">{p.detail}</div>
              </div>
              <div className="hidden flex-none flex-col items-end gap-1.5 sm:flex">
                <Badge tone={p.impactTone} className="px-2 py-0.5 text-[10.5px]">
                  {p.impact}
                </Badge>
                <span className="flex items-center gap-1 text-[10.5px] text-fg-4">
                  <Sparkles size={11} strokeWidth={1.9} aria-hidden />
                  {p.brain}
                </span>
              </div>
              <Button variant="ghost" size="sm" iconRight={ArrowRight} className="flex-none">
                {p.action}
              </Button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  return (
    <Card clickable className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-fg-3">{kpi.label}</span>
        <span style={{ color: TONE_HEX[kpi.sparkTone] }}>
          <Icon size={16} strokeWidth={1.9} aria-hidden />
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
          {kpi.value}
        </div>
        <Sparkline points={kpi.spark} tone={kpi.sparkTone} className="mb-1 flex-none" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Badge tone={kpi.deltaTone} className="px-2 py-0.5 text-[10.5px] tabular-nums">
          {kpi.delta}
        </Badge>
        <span className="truncate text-[11.5px] text-fg-5">{kpi.sub}</span>
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
            <span>Trust</span>
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
        title={
          <span className="flex items-center gap-2">
            <Zap size={16} strokeWidth={2} className="text-gold-1" aria-hidden />
            Synergy alerts
          </span>
        }
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
              className="flex items-start gap-3 rounded-xl p-2.5 transition hover:bg-surface-1"
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

function NoOrgState() {
  return (
    <AppShell title="Command Center" subtitle="Your private-market command center">
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
    <AppShell title="Command Center" subtitle="Your private-market command center">
      <div className="flex flex-col gap-[22px]">
        <EarnBriefing data={data} />

        <Priorities />

        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {kpis.map((k) => (
            <KpiCard key={k.label} kpi={k} />
          ))}
        </div>

        <div className="grid gap-[18px] lg:grid-cols-[1.5fr_1fr]">
          <DealFlow data={data} />
          <SynergyFeed />
        </div>
      </div>
    </AppShell>
  );
}
