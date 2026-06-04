'use client';

import { useState } from 'react';
import {
  TrendingUp,
  CircleDot,
  CheckCircle2,
  Percent,
  Plus,
  Sparkles,
  LayoutGrid,
  Radar,
  type LucideIcon
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionTitle,
  SegTabs,
  type AvatarTone,
  type BadgeTone
} from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { TONE_HEX } from '@/components/screens/tone';

/* ---- Mock data — shaped to mirror the `deals` / `contacts` / `relationships` tables ---- */

interface DealCard {
  id: string;
  name: string;
  detail: string;
  tone: BadgeTone;
}

interface FormationStage {
  key: string;
  label: string;
  cards: DealCard[];
}

const FORMATION_STAGES: FormationStage[] = [
  {
    key: 'visitor',
    label: 'Visitor',
    cards: [
      { id: 'lp-301', name: 'Inbound: pe-curious.com', detail: 'Website lead', tone: 'neutral' }
    ]
  },
  {
    key: 'prospect',
    label: 'Prospect',
    cards: [
      { id: 'lp-302', name: 'Aurelius Capital', detail: 'Fund of funds', tone: 'neutral' },
      { id: 'lp-303', name: 'Westport Family', detail: 'Family office', tone: 'neutral' }
    ]
  },
  {
    key: 'qualified',
    label: 'Qualified',
    cards: [{ id: 'lp-304', name: 'Coastal Pension', detail: '$15M+ mandate', tone: 'azure' }]
  },
  {
    key: 'meeting',
    label: 'Meeting',
    cards: [{ id: 'lp-305', name: 'Bridgepoint UHNW', detail: 'Call booked Thu', tone: 'azure' }]
  },
  {
    key: 'diligence',
    label: 'Diligence',
    cards: [{ id: 'lp-306', name: 'Granite Endowment', detail: 'DDQ in review', tone: 'warning' }]
  },
  {
    key: 'soft-circle',
    label: 'Soft circle',
    cards: [
      { id: 'lp-307', name: 'Granite Endowment', detail: '$10M soft-circled', tone: 'warning' }
    ]
  },
  {
    key: 'committed',
    label: 'Committed',
    cards: [{ id: 'lp-308', name: 'Meridian FO', detail: '$6M committed', tone: 'success' }]
  },
  {
    key: 'closed',
    label: 'Closed',
    cards: [{ id: 'lp-309', name: 'Halcyon Mezz', detail: '$4M wired', tone: 'success' }]
  }
];

interface SummaryStat {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: BadgeTone;
}

const SUMMARY: SummaryStat[] = [
  { label: 'Pipeline value', value: '$182M', icon: TrendingUp, tone: 'azure' },
  { label: 'Soft-circled', value: '$10M', icon: CircleDot, tone: 'warning' },
  { label: 'Committed', value: '$6M', icon: CheckCircle2, tone: 'success' },
  { label: 'Visitor → committed', value: '38%', icon: Percent, tone: 'gold' }
];

interface RelationshipTier {
  label: string;
  tone: BadgeTone;
}

const REL_TIERS: Record<string, RelationshipTier> = {
  strong: { label: 'Strong', tone: 'success' },
  warm: { label: 'Warm', tone: 'gold' },
  cold: { label: 'Cold', tone: 'neutral' }
};

interface Lp {
  id: string;
  name: string;
  type: string;
  rel: keyof typeof REL_TIERS;
  check: string;
  via: string;
  fit: number;
}

const LPS: Lp[] = [
  {
    id: 'lp-304',
    name: 'Coastal Pension',
    type: 'Public pension',
    rel: 'warm',
    check: '$15M',
    via: 'Marcus Lee',
    fit: 91
  },
  {
    id: 'lp-302',
    name: 'Aurelius Capital',
    type: 'Fund of funds',
    rel: 'strong',
    check: '$25M',
    via: 'Direct',
    fit: 88
  },
  {
    id: 'lp-306',
    name: 'Granite Endowment',
    type: 'Endowment',
    rel: 'warm',
    check: '$10M',
    via: 'Jordan Park',
    fit: 84
  },
  {
    id: 'lp-308',
    name: 'Meridian FO',
    type: 'Family office',
    rel: 'strong',
    check: '$6M',
    via: 'Direct',
    fit: 78
  },
  {
    id: 'lp-303',
    name: 'Westport Family',
    type: 'Family office',
    rel: 'cold',
    check: '$8M',
    via: 'No path',
    fit: 62
  },
  {
    id: 'lp-310',
    name: 'Lakeview Endowment',
    type: 'Endowment',
    rel: 'cold',
    check: '$12M',
    via: 'Avery Chen',
    fit: 54
  }
];

type Tab = 'formation' | 'lpmap';

function EarnBand() {
  return (
    <Card className="flex items-center gap-4 bg-[linear-gradient(100deg,rgba(247,201,72,0.08),transparent_58%)] px-[18px] py-3.5">
      <EarnCoin size={36} glow />
      <div className="min-w-0 flex-1 text-[13px] text-fg-2">
        <span className="font-semibold text-fg-1">Earnest Fundmaker</span>, your private-market
        assistant, is tracking <span className="font-semibold text-gold-1">9 investors</span> across
        8 formation stages — 3 need a follow-up today.
      </div>
      <Badge tone="azure" dot pulse className="flex-none">
        2 moved this week
      </Badge>
    </Card>
  );
}

function FormationBoard() {
  return (
    <Card>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {FORMATION_STAGES.map((stage, i) => (
          <div key={stage.key} className="w-48 flex-none">
            <div className="flex items-center justify-between px-1 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-fg-5">{i + 1}</span>
                <span className="text-xs font-semibold text-fg-2">{stage.label}</span>
              </div>
              <span className="text-[11px] tabular-nums text-fg-5">{stage.cards.length}</span>
            </div>
            <div className="flex min-h-16 flex-col gap-2 rounded-xl border border-dashed border-hairline-faint bg-white/[0.02] p-2">
              {stage.cards.map((c) => {
                const avatarTone: AvatarTone = c.tone === 'neutral' ? 'azure' : c.tone;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="rounded-xl border border-hairline bg-surface-2 p-2.5 text-left transition hover:bg-surface-3"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar name={c.name} size={22} tone={avatarTone} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg-1">
                        {c.name}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[10.5px] text-fg-4">{c.detail}</span>
                      <span
                        className="h-[7px] w-[7px] rounded-full"
                        style={{ background: TONE_HEX[c.tone] }}
                        aria-hidden
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LpCapitalMap() {
  return (
    <Card>
      <SectionTitle
        eyebrow="Network → capital · relationship + fit scoring"
        title="LP Capital Map"
        action={
          <Button variant="ghost" size="sm" icon={Sparkles}>
            Find intros
          </Button>
        }
      />
      <div className="grid grid-cols-[1.6fr_1fr_0.8fr_1.1fr_1.3fr] gap-2 px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        <span>Investor</span>
        <span>Relationship</span>
        <span>Check</span>
        <span>Warm intro via</span>
        <span>Thesis fit</span>
      </div>
      <div className="mb-1 h-px bg-hairline" />
      <div className="flex flex-col">
        {LPS.map((lp) => {
          const tier = REL_TIERS[lp.rel];
          const fitColor =
            lp.fit > 85 ? 'var(--success)' : lp.fit > 70 ? 'var(--gold-1)' : 'var(--fg-4)';
          return (
            <div
              key={lp.id}
              className="grid grid-cols-[1.6fr_1fr_0.8fr_1.1fr_1.3fr] items-center gap-2 rounded-lg px-1 py-2.5 transition hover:bg-surface-1"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-fg-1">{lp.name}</div>
                <div className="text-[10.5px] text-fg-5">{lp.type}</div>
              </div>
              <div>
                <Badge tone={tier.tone} dot className="text-[10px]">
                  {tier.label}
                </Badge>
              </div>
              <span className="font-mono text-[11.5px] tabular-nums text-fg-3">{lp.check}</span>
              <span
                className={
                  lp.via === 'No path' ? 'text-[11.5px] text-fg-5' : 'text-[11.5px] text-fg-2'
                }
              >
                {lp.via}
              </span>
              <div className="flex items-center gap-2">
                <ProgressBar value={lp.fit} color={fitColor} height={5} className="flex-1" />
                <span className="w-6 text-right text-[11px] tabular-nums text-fg-3">{lp.fit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function PipelinePage() {
  const [tab, setTab] = useState<Tab>('formation');
  return (
    <AppShell title="Pipeline" subtitle="Capital formation command center">
      <div className="flex flex-col gap-[18px]">
        <div className="flex items-end justify-between">
          <div className="text-[13px] text-fg-4">8 formation stages · 9 active investors</div>
          <Button variant="primary" icon={Plus}>
            Add to pipeline
          </Button>
        </div>

        <EarnBand />

        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {SUMMARY.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-medium text-fg-3">{s.label}</span>
                  <span style={{ color: TONE_HEX[s.tone] }}>
                    <Icon size={15} strokeWidth={1.9} aria-hidden />
                  </span>
                </div>
                <div className="mt-2 text-[23px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                  {s.value}
                </div>
              </Card>
            );
          })}
        </div>

        <SegTabs
          active={tab}
          onChange={(id) => setTab(id as Tab)}
          tabs={[
            { id: 'formation', label: 'Capital formation', icon: LayoutGrid },
            { id: 'lpmap', label: 'LP Capital Map', icon: Radar }
          ]}
        />

        {tab === 'formation' ? <FormationBoard /> : <LpCapitalMap />}
      </div>
    </AppShell>
  );
}
