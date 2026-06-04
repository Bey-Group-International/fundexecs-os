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

export const metadata: Metadata = { title: 'Command Center' };

interface Kpi {
  label: string;
  value: string;
  delta: string;
  sub: string;
  icon: LucideIcon;
  tone: BadgeTone;
}

const KPIS: Kpi[] = [
  {
    label: 'Active deals',
    value: '18',
    delta: '+3',
    sub: 'vs last month',
    icon: TrendingUp,
    tone: 'success'
  },
  {
    label: 'Capital in motion',
    value: '$284M',
    delta: '+12%',
    sub: 'across 5 deals',
    icon: Banknote,
    tone: 'gold'
  },
  {
    label: 'LP conversations',
    value: '32',
    delta: '+7',
    sub: '9 warm this week',
    icon: Handshake,
    tone: 'azure'
  },
  {
    label: 'Fund readiness',
    value: '74%',
    delta: '+5%',
    sub: '11 of 15 steps',
    icon: Target,
    tone: 'info'
  }
];

interface Deal {
  id: string;
  name: string;
  type: string;
  stage: string;
  amount: string;
  trust: number;
  tone: BadgeTone;
}

const DEALS: Deal[] = [
  {
    id: 'dl-187',
    name: 'Atlas Manufacturing',
    type: 'Growth equity',
    stage: 'Diligence',
    amount: '$48M',
    trust: 68,
    tone: 'gold'
  },
  {
    id: 'dl-204',
    name: 'Cedar Logistics',
    type: 'Buyout',
    stage: 'Term sheet',
    amount: '$112M',
    trust: 82,
    tone: 'success'
  },
  {
    id: 'dl-219',
    name: 'Meridian Health',
    type: 'Series B',
    stage: 'Sourcing',
    amount: '$26M',
    trust: 34,
    tone: 'azure'
  },
  {
    id: 'dl-231',
    name: 'Granite Software',
    type: 'Secondary',
    stage: 'Closing',
    amount: '$58M',
    trust: 91,
    tone: 'success'
  }
];

const TONE_HEX: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};

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

interface WarmConnection {
  name: string;
  company: string;
  via: string;
  strength: number;
  tone: BadgeTone;
}

const WARM_CONNECTIONS: WarmConnection[] = [
  {
    name: 'Dana Whitfield',
    company: 'Sequoia Heritage',
    via: 'Marcus Lee can intro you',
    strength: 88,
    tone: 'success'
  },
  {
    name: 'Priya Nair',
    company: 'Lakeview Endowment',
    via: 'Jordan Park can intro you',
    strength: 71,
    tone: 'gold'
  },
  {
    name: 'Tomás Rivera',
    company: 'Beacon Family Office',
    via: 'Avery Chen can intro you',
    strength: 64,
    tone: 'gold'
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

function EarnBriefing() {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-4 border-b border-hairline bg-[linear-gradient(105deg,rgba(247,201,72,0.11),rgba(247,201,72,0.02)_46%,transparent_72%)] px-5 py-[18px]">
        <span className="inline-flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-gold-1 to-gold-2 text-lg font-bold text-[#070b14]">
          E
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15.5px] font-semibold tracking-[-0.015em] text-fg-1">
              Good morning, Avery.
            </span>
            <Badge tone="gold" className="px-1.5 py-px text-[9.5px]">
              Earn
            </Badge>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">
            <span className="font-semibold text-fg-2">Earnest Fundmaker</span>, your private-market
            assistant, is monitoring 18 deals, 5 LP conversations, and 2 flagged items —{' '}
            <span className="font-semibold text-gold-1">3 actions</span> need you today.
          </p>
        </div>
        <Button variant="gold" icon={Sparkles} className="flex-none">
          Ask Earn
        </Button>
      </div>
    </Card>
  );
}

function DealFlow() {
  return (
    <Card>
      <SectionTitle
        eyebrow="18 active"
        title="Deal flow"
        action={
          <Button variant="ghost" size="sm" iconRight={ArrowRight}>
            Pipeline
          </Button>
        }
      />
      <div className="grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr] gap-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        <span>Deal</span>
        <span>Stage</span>
        <span>Size</span>
        <span>Trust</span>
      </div>
      <div className="my-2 h-px bg-hairline" />
      <div className="flex flex-col gap-0.5">
        {DEALS.map((d) => (
          <div
            key={d.id}
            className="grid grid-cols-[1.6fr_1fr_0.8fr_1.2fr] items-center gap-2 rounded-lg px-1.5 py-2.5 transition hover:bg-surface-1"
          >
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-fg-1">{d.name}</div>
              <div className="text-[11px] text-fg-5">{d.type}</div>
            </div>
            <span className="text-xs text-fg-3">{d.stage}</span>
            <span className="text-[12.5px] font-medium tabular-nums text-fg-2">{d.amount}</span>
            <div className="flex items-center gap-2">
              <ProgressBar value={d.trust} color={TONE_HEX[d.tone]} height={5} className="flex-1" />
              <span className="w-7 text-right text-[11px] tabular-nums text-fg-4">{d.trust}%</span>
            </div>
          </div>
        ))}
      </div>
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

function WarmConnectionsPanel() {
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
      <div className="flex flex-col gap-2">
        {WARM_CONNECTIONS.map((c) => (
          <div
            key={c.name}
            className="flex items-center justify-between gap-3 rounded-xl px-1.5 py-2 hover:bg-surface-1"
          >
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold text-fg-1">{c.name}</div>
              <div className="truncate text-[11px] text-fg-5">
                {c.company} · {c.via}
              </div>
            </div>
            <Badge tone={c.tone} className="px-2 py-0.5 text-[10.5px] tabular-nums">
              {c.strength}
            </Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function CommandCenterPage() {
  return (
    <AppShell title="Command Center" subtitle="Your private-market briefing">
      <div className="flex flex-col gap-[18px]">
        <EarnBriefing />

        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {KPIS.map((k) => (
            <KpiCard key={k.label} kpi={k} />
          ))}
        </div>

        <div className="grid gap-[18px] lg:grid-cols-[1.5fr_1fr]">
          <DealFlow />
          <div className="flex flex-col gap-[18px]">
            <SynergyFeed />
            <WarmConnectionsPanel />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
