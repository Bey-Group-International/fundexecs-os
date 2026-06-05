'use client';

import { useMemo, useState } from 'react';
import {
  TrendingUp,
  CircleDot,
  CheckCircle2,
  Percent,
  Plus,
  Sparkles,
  Columns3,
  Radar,
  ArrowUpRight,
  Briefcase,
  type LucideIcon
} from 'lucide-react';
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
import type { PipelineData, PipelineDeal } from '@/lib/queries/pipeline';
import { NewDealDrawer } from '@/components/drawers/NewDealDrawer';
import { DealDetailDrawer, type DealDetailData } from '@/components/drawers/DealDetailDrawer';

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount}`;
}

/** Pick a card accent tone from a deal's status. */
function dealTone(status: string, stageKey: string): BadgeTone {
  const s = `${status} ${stageKey}`.toLowerCase();
  if (s.includes('closed') || s.includes('committed') || s.includes('won')) return 'success';
  if (s.includes('diligence') || s.includes('soft') || s.includes('risk')) return 'warning';
  if (s.includes('lost') || s.includes('dead')) return 'danger';
  return 'azure';
}

type Tab = 'formation' | 'lpmap' | 'flow' | 'partners';

function EarnBand({ data }: { data: PipelineData }) {
  const activeStages = data.stages.filter((s) => s.deals.length > 0).length;
  return (
    <Card className="flex items-center gap-4 bg-[linear-gradient(100deg,rgba(247,201,72,0.08),transparent_58%)] px-[18px] py-3.5">
      <EarnCoin size={36} glow />
      <div className="min-w-0 flex-1 text-[13px] text-fg-2">
        <span className="font-semibold text-fg-1">Earnest Fundmaker</span>, your private market
        assistant, is tracking{' '}
        <span className="font-semibold text-gold-1">
          {data.totalDeals} {data.totalDeals === 1 ? 'investor' : 'investors'}
        </span>{' '}
        across {activeStages} formation {activeStages === 1 ? 'stage' : 'stages'}.
      </div>
      <Badge tone="azure" dot pulse className="flex-none">
        Live pipeline
      </Badge>
    </Card>
  );
}

function FormationBoard({
  data,
  onSelectDeal
}: {
  data: PipelineData;
  onSelectDeal: (deal: PipelineDeal) => void;
}) {
  return (
    <Card>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {data.stages.map((stage, i) => (
          <div key={stage.key} className="w-[200px] flex-none">
            <div className="flex items-center justify-between px-1 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tabular-nums text-fg-5">{i + 1}</span>
                <span className="text-xs font-semibold text-fg-2">{stage.label}</span>
              </div>
              <span className="text-[11px] tabular-nums text-fg-5">{stage.deals.length}</span>
            </div>
            <div className="flex min-h-20 flex-col gap-2 rounded-xl border border-dashed border-hairline-faint bg-white/[0.02] p-2">
              {stage.deals.map((d) => {
                const tone = dealTone(d.status, stage.key);
                const avatarTone: AvatarTone = tone === 'danger' ? 'gold' : tone;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onSelectDeal(d)}
                    className="rounded-xl border border-hairline bg-surface-2 p-2.5 text-left transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]"
                    data-testid={`pipeline-deal-${d.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar name={d.name} size={22} tone={avatarTone} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg-1">
                        {d.name}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[10.5px] text-fg-4">
                        {d.amount != null ? `${formatCurrency(d.amount)} · ${d.note}` : d.note}
                      </span>
                      <span
                        className="h-[7px] w-[7px] flex-none rounded-full"
                        style={{ background: TONE_HEX[tone] }}
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

/** Relationship tier label derived from a deal's formation stage. */
function relationshipTier(stage: string): { label: string; tone: BadgeTone } {
  const s = stage.toLowerCase();
  if (s.includes('committed') || s.includes('closed')) return { label: 'Anchor', tone: 'success' };
  if (s.includes('soft') || s.includes('diligence')) return { label: 'Priority', tone: 'gold' };
  if (s.includes('meeting') || s.includes('qualified')) return { label: 'Engaged', tone: 'azure' };
  return { label: 'Watch', tone: 'neutral' };
}

/** A stable, deterministic thesis-fit score for a deal (presentational). */
function thesisFit(deal: PipelineDeal): number {
  let h = 0;
  for (let i = 0; i < deal.id.length; i += 1) h = (h * 31 + deal.id.charCodeAt(i)) % 1000;
  const base = relationshipTier(deal.stage).label === 'Anchor' ? 82 : 58;
  return Math.min(98, base + (h % 18));
}

function LpCapitalMap({ deals }: { deals: PipelineDeal[] }) {
  const ranked = useMemo(() => [...deals].sort((a, b) => thesisFit(b) - thesisFit(a)), [deals]);
  return (
    <Card>
      <SectionTitle
        eyebrow="Relationship tier · thesis-fit scoring"
        title="LP Capital Map"
        action={
          <Button variant="ghost" size="sm" icon={Sparkles}>
            Find intros
          </Button>
        }
      />
      {ranked.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-5">
          No investors in the pipeline yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[1.6fr_0.9fr_0.7fr_1.3fr] gap-2 px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            <span>Investor</span>
            <span>Tier</span>
            <span>Ticket</span>
            <span>Thesis fit</span>
          </div>
          <div className="mb-1 h-px bg-hairline" />
          <div className="flex flex-col">
            {ranked.map((d) => {
              const tier = relationshipTier(d.stage);
              const fit = thesisFit(d);
              const color =
                fit > 75 ? 'var(--success)' : fit > 55 ? 'var(--gold-1)' : 'var(--fg-4)';
              return (
                <div
                  key={d.id}
                  className="grid grid-cols-[1.6fr_0.9fr_0.7fr_1.3fr] items-center gap-2 rounded-lg px-1 py-2.5 transition hover:bg-surface-1"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar
                      name={d.name}
                      size={26}
                      tone={tier.tone === 'neutral' ? 'azure' : tier.tone}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-fg-1">{d.name}</div>
                      <div className="text-[10.5px] text-fg-5">{d.note}</div>
                    </div>
                  </div>
                  <span>
                    <Badge tone={tier.tone} className="text-[10px]">
                      {tier.label}
                    </Badge>
                  </span>
                  <span className="font-mono text-[11.5px] tabular-nums text-fg-3">
                    {d.amount != null ? formatCurrency(d.amount) : '—'}
                  </span>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={fit} color={color} height={5} className="flex-1" />
                    <span className="w-7 text-right text-[11px] tabular-nums text-fg-3">
                      {fit}%
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

function DealFlow({ data }: { data: PipelineData }) {
  const recent = data.stages
    .flatMap((s) => s.deals.map((d) => ({ deal: d, stageLabel: s.label, stageKey: s.key })))
    .slice(0, 8);
  return (
    <Card>
      <SectionTitle eyebrow="Recent movement · last 30 days" title="Deal flow" />
      {recent.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-5">No deal activity yet.</p>
      ) : (
        <div className="flex flex-col">
          {recent.map(({ deal, stageLabel, stageKey }) => {
            const tone = dealTone(deal.status, stageKey);
            return (
              <div
                key={deal.id}
                className="flex items-center gap-3 rounded-lg px-1 py-2.5 transition hover:bg-surface-1"
              >
                <Avatar name={deal.name} size={28} tone={tone === 'danger' ? 'gold' : tone} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-fg-1">{deal.name}</div>
                  <div className="text-[11px] text-fg-4">{deal.note}</div>
                </div>
                <Badge tone={tone} className="text-[10px]">
                  {stageLabel}
                </Badge>
                <span className="w-16 text-right font-mono text-[11.5px] tabular-nums text-fg-3">
                  {deal.amount != null ? formatCurrency(deal.amount) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Presentational capital-stack partners — no backing table exists yet. */
const PARTNERS: Array<{ name: string; role: string; status: string; tone: BadgeTone }> = [
  { name: 'Fund administrator', role: 'Carta Fund Admin', status: 'Engaged', tone: 'success' },
  { name: 'Legal counsel', role: 'Cooley LLP', status: 'Engaged', tone: 'success' },
  { name: 'Placement agent', role: 'Unassigned', status: 'Open', tone: 'warning' },
  { name: 'Prime broker', role: 'Unassigned', status: 'Open', tone: 'warning' },
  { name: 'Audit & tax', role: 'In review', status: 'Pending', tone: 'azure' }
];

function PartnersStack() {
  return (
    <Card>
      <SectionTitle
        eyebrow="Service providers · capital stack"
        title="Partners & services"
        action={
          <Button variant="ghost" size="sm" icon={Plus}>
            Add partner
          </Button>
        }
      />
      <div className="grid gap-2.5 sm:grid-cols-2">
        {PARTNERS.map((p) => (
          <div
            key={p.name}
            className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3"
          >
            <Avatar
              name={p.role === 'Unassigned' || p.role === 'In review' ? '? ?' : p.role}
              size={32}
              tone={p.tone}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-fg-1">{p.name}</div>
              <div className="truncate text-[11px] text-fg-4">{p.role}</div>
            </div>
            <Badge tone={p.tone} className="text-[10px]">
              {p.status}
            </Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function PipelineView({ data }: { data: PipelineData }) {
  const [tab, setTab] = useState<Tab>('formation');
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [activeDeal, setActiveDeal] = useState<DealDetailData | null>(null);

  function selectDeal(d: PipelineDeal) {
    setActiveDeal({
      id: d.id,
      name: d.name,
      stage: d.stage,
      status: d.status,
      amount: d.amount,
      allocations: d.allocations
    });
  }

  const summary: Array<{ label: string; value: string; icon: LucideIcon; tone: BadgeTone }> = [
    {
      label: 'Pipeline value',
      value: formatCurrency(data.pipelineValue),
      icon: TrendingUp,
      tone: 'azure'
    },
    {
      label: 'Soft-circled',
      value: formatCurrency(data.softCircled),
      icon: CircleDot,
      tone: 'warning'
    },
    {
      label: 'Committed',
      value: formatCurrency(data.committed),
      icon: CheckCircle2,
      tone: 'success'
    },
    {
      label: 'Visitor → committed',
      value: `${data.conversionPct}%`,
      icon: Percent,
      tone: 'gold'
    }
  ];

  const allDeals = data.stages.flatMap((s) => s.deals);

  return (
    <div className="flex flex-col gap-[18px]">
      <SectionTitle
        eyebrow="Capital formation command center"
        title="Pipeline"
        className="mb-0"
        action={
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => setNewDealOpen(true)}
            data-testid="pipeline-add"
          >
            Add to pipeline
          </Button>
        }
      />

      <EarnBand data={data} />

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {summary.map((s) => {
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
          { id: 'formation', label: 'Capital formation', icon: Columns3 },
          { id: 'lpmap', label: 'LP Capital Map', icon: Radar },
          { id: 'flow', label: 'Deal flow', icon: ArrowUpRight },
          { id: 'partners', label: 'Partners & services', icon: Briefcase }
        ]}
      />

      {tab === 'formation' && <FormationBoard data={data} onSelectDeal={selectDeal} />}
      {tab === 'lpmap' && <LpCapitalMap deals={allDeals} />}
      {tab === 'flow' && <DealFlow data={data} />}
      {tab === 'partners' && <PartnersStack />}

      <NewDealDrawer open={newDealOpen} onClose={() => setNewDealOpen(false)} />
      <DealDetailDrawer
        open={activeDeal !== null}
        onClose={() => setActiveDeal(null)}
        deal={activeDeal}
      />
    </div>
  );
}
