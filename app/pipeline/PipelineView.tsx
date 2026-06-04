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

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount}`;
}

/** Pick a card accent tone from a deal's status. */
function dealTone(status: string): BadgeTone {
  const s = status.toLowerCase();
  if (s === 'closed' || s === 'committed' || s === 'won') return 'success';
  if (s === 'diligence' || s === 'soft-circle' || s === 'at_risk') return 'warning';
  if (s === 'lost' || s === 'dead') return 'danger';
  return 'azure';
}

type Tab = 'formation' | 'lpmap';

function EarnBand({ data }: { data: PipelineData }) {
  const activeStages = data.stages.filter((s) => s.deals.length > 0).length;
  return (
    <Card className="flex items-center gap-4 bg-[linear-gradient(100deg,rgba(247,201,72,0.08),transparent_58%)] px-[18px] py-3.5">
      <EarnCoin size={36} glow />
      <div className="min-w-0 flex-1 text-[13px] text-fg-2">
        <span className="font-semibold text-fg-1">Earnest Fundmaker</span>, your private-market
        assistant, is tracking{' '}
        <span className="font-semibold text-gold-1">{data.totalDeals} deals</span> across{' '}
        {activeStages} active formation {activeStages === 1 ? 'stage' : 'stages'}.
      </div>
      <Badge tone="azure" dot pulse className="flex-none">
        Live
      </Badge>
    </Card>
  );
}

function FormationBoard({ data }: { data: PipelineData }) {
  return (
    <Card>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {data.stages.map((stage, i) => (
          <div key={stage.key} className="w-48 flex-none">
            <div className="flex items-center justify-between px-1 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-fg-5">{i + 1}</span>
                <span className="text-xs font-semibold text-fg-2">{stage.label}</span>
              </div>
              <span className="text-[11px] tabular-nums text-fg-5">{stage.deals.length}</span>
            </div>
            <div className="flex min-h-16 flex-col gap-2 rounded-xl border border-dashed border-hairline-faint bg-white/[0.02] p-2">
              {stage.deals.map((d) => {
                const tone = dealTone(d.status);
                const avatarTone: AvatarTone = tone === 'danger' ? 'gold' : tone;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className="rounded-xl border border-hairline bg-surface-2 p-2.5 text-left transition hover:bg-surface-3"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar name={d.name} size={22} tone={avatarTone} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg-1">
                        {d.name}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[10.5px] text-fg-4">
                        {d.amount != null ? formatCurrency(d.amount) : d.status}
                      </span>
                      <span
                        className="h-[7px] w-[7px] rounded-full"
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

function LpCapitalMap({ deals }: { deals: PipelineDeal[] }) {
  const max = deals.reduce((m, d) => Math.max(m, d.amount ?? 0), 0);
  return (
    <Card>
      <SectionTitle
        eyebrow="Capital by deal · size-weighted ranking"
        title="LP Capital Map"
        action={
          <Button variant="ghost" size="sm" icon={Sparkles}>
            Find intros
          </Button>
        }
      />
      {deals.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-5">No deals in the pipeline yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-[1.6fr_1fr_0.8fr_1.3fr] gap-2 px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            <span>Deal</span>
            <span>Stage</span>
            <span>Size</span>
            <span>Relative weight</span>
          </div>
          <div className="mb-1 h-px bg-hairline" />
          <div className="flex flex-col">
            {deals.map((d) => {
              const pct = max > 0 ? Math.round(((d.amount ?? 0) / max) * 100) : 0;
              const color =
                pct > 66 ? 'var(--success)' : pct > 33 ? 'var(--gold-1)' : 'var(--fg-4)';
              return (
                <div
                  key={d.id}
                  className="grid grid-cols-[1.6fr_1fr_0.8fr_1.3fr] items-center gap-2 rounded-lg px-1 py-2.5 transition hover:bg-surface-1"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{d.name}</div>
                    <div className="text-[10.5px] text-fg-5">{d.status}</div>
                  </div>
                  <span className="text-[11.5px] text-fg-2">{d.stage}</span>
                  <span className="font-mono text-[11.5px] tabular-nums text-fg-3">
                    {d.amount != null ? formatCurrency(d.amount) : '—'}
                  </span>
                  <div className="flex items-center gap-2">
                    <ProgressBar value={pct} color={color} height={5} className="flex-1" />
                    <span className="w-6 text-right text-[11px] tabular-nums text-fg-3">{pct}</span>
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

export function PipelineView({ data }: { data: PipelineData }) {
  const [tab, setTab] = useState<Tab>('formation');

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
    { label: 'Conversion', value: `${data.conversionPct}%`, icon: Percent, tone: 'gold' }
  ];

  const allDeals = data.stages
    .flatMap((s) => s.deals)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  const activeStages = data.stages.filter((s) => s.deals.length > 0).length;

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-end justify-between">
        <div className="text-[13px] text-fg-4">
          {activeStages} active {activeStages === 1 ? 'stage' : 'stages'} · {data.totalDeals} deals
        </div>
        <Button variant="primary" icon={Plus}>
          Add to pipeline
        </Button>
      </div>

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
          { id: 'formation', label: 'Capital formation', icon: LayoutGrid },
          { id: 'lpmap', label: 'LP Capital Map', icon: Radar }
        ]}
      />

      {tab === 'formation' ? <FormationBoard data={data} /> : <LpCapitalMap deals={allDeals} />}
    </div>
  );
}
