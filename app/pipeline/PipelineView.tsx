'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RevealGroup, RevealItem } from '@/components/dashboard/command';
import { FX_SPRING } from '@/components/dashboard/command/motion';
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
import type {
  PipelineData,
  PipelineDeal,
  PipelinePartner,
  PipelineStage
} from '@/lib/queries/pipeline';
import { updateDealStage } from '@/lib/actions/deals';
import { NewDealDrawer } from '@/components/drawers/NewDealDrawer';
import { NewPartnerDrawer } from '@/components/drawers/NewPartnerDrawer';
import { DealDetailDrawer, type DealDetailData } from '@/components/drawers/DealDetailDrawer';
import { LpPipelineBoard } from '@/components/pipeline/LpPipelineBoard';
import type { LpPipelineData } from '@/lib/pipeline/lp-stages';

const USD_NO_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return USD_NO_CENTS.format(amount);
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
        <span className="font-semibold text-fg-1">Earn</span> is working the book —{' '}
        <span className="font-semibold text-gold-1">
          {data.totalDeals} {data.totalDeals === 1 ? 'relationship' : 'relationships'}
        </span>{' '}
        live across {activeStages} formation {activeStages === 1 ? 'stage' : 'stages'}, every move
        on the record.
      </div>
      <Badge tone="azure" dot pulse className="flex-none">
        Live pipeline
      </Badge>
    </Card>
  );
}

function FormationBoard({
  stages,
  onSelectDeal,
  onMoveDeal,
  pendingDealId
}: {
  stages: PipelineStage[];
  onSelectDeal: (deal: PipelineDeal) => void;
  onMoveDeal: (dealId: string, toStageKey: string) => void;
  pendingDealId: string | null;
}) {
  const [overKey, setOverKey] = useState<string | null>(null);

  return (
    <Card>
      <p className="mb-2 px-1 text-[11px] text-fg-4">Drag a deal between stages to move it.</p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {stages.map((stage, i) => (
          <div
            key={stage.key}
            className="w-[200px] flex-none"
            onDragOver={(e) => {
              e.preventDefault();
              if (overKey !== stage.key) setOverKey(stage.key);
            }}
            onDragLeave={() => setOverKey((k) => (k === stage.key ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              setOverKey(null);
              const id = e.dataTransfer.getData('text/plain');
              if (id) onMoveDeal(id, stage.key);
            }}
          >
            <div className="flex items-center justify-between px-1 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tabular-nums text-fg-4">{i + 1}</span>
                <span className="text-xs font-semibold text-fg-2">{stage.label}</span>
              </div>
              <span className="text-[11px] tabular-nums text-fg-3">{stage.deals.length}</span>
            </div>
            <div
              className={`flex min-h-20 flex-col gap-2 rounded-xl border border-dashed p-2 transition ${
                overKey === stage.key
                  ? 'border-[var(--accent-line)] bg-[var(--accent-soft,rgba(37,99,235,0.12))]'
                  : 'border-hairline bg-bg-2'
              }`}
            >
              {stage.deals.map((d) => {
                const tone = dealTone(d.status, stage.key);
                const avatarTone: AvatarTone = tone === 'danger' ? 'gold' : tone;
                const pending = pendingDealId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    draggable={!pending}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', d.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onSelectDeal(d)}
                    className={`rounded-xl border border-hairline bg-surface-3 p-2.5 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent-line)] hover:shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] ${
                      pending ? 'opacity-50' : 'cursor-grab active:cursor-grabbing'
                    }`}
                    data-testid={`pipeline-deal-${d.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar name={d.name} size={22} tone={avatarTone} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg-1">
                        {d.name}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[10.5px] text-fg-3">
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

function DealFlow({ data }: { data: PipelineData }) {
  const recent = data.stages
    .flatMap((s) => s.deals.map((d) => ({ deal: d, stageLabel: s.label, stageKey: s.key })))
    .slice(0, 8);
  return (
    <Card>
      <SectionTitle eyebrow="Recent movement · last 30 days" title="Deal flow" />
      {recent.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-4">No deal activity yet.</p>
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
                  <div className="text-[11px] text-fg-3">{deal.note}</div>
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

/** Tone for a partner's free-form status string. */
function partnerTone(status: string): BadgeTone {
  const s = status.toLowerCase();
  if (/active|engaged|committed|closed|won|live/.test(s)) return 'success';
  if (/open|prospect|pending|unassigned/.test(s)) return 'warning';
  return 'azure';
}

function PartnersStack({ partners, onAdd }: { partners: PipelinePartner[]; onAdd: () => void }) {
  return (
    <Card>
      <SectionTitle
        eyebrow="Service providers · capital stack"
        title="Partners & services"
        action={
          <Button variant="ghost" size="sm" icon={Plus} onClick={onAdd} data-testid="add-partner">
            Add partner
          </Button>
        }
      />
      {partners.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-fg-4">
          No partners yet. Add your first service provider to build out the capital stack.
        </p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {partners.map((p) => {
            const tone = partnerTone(p.status);
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3"
              >
                <Avatar name={p.name} size={32} tone={tone} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-fg-1">{p.name}</div>
                  <div className="truncate text-[11px] capitalize text-fg-3">
                    {p.role.replace(/_/g, ' ')}
                  </div>
                </div>
                <Badge tone={tone} className="text-[10px] capitalize">
                  {p.status}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function PipelineView({ data, lpData }: { data: PipelineData; lpData: LpPipelineData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('formation');
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [newPartnerOpen, setNewPartnerOpen] = useState(false);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  // Optimistic stage moves (dealId → target stage key) applied over the server
  // data so a drag feels instant; reconciled by router.refresh() on success and
  // reverted on failure.
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [pendingDealId, setPendingDealId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [, startMove] = useTransition();

  // Derived (React Compiler memoizes) — no manual useMemo needed.
  const origKeyOf = new Map<string, string>();
  for (const s of data.stages) for (const d of s.deals) origKeyOf.set(d.id, s.key);

  const hasMoves = Object.keys(moves).length > 0;
  const allStageDeals = data.stages.flatMap((s) => s.deals);
  const displayStages = hasMoves
    ? data.stages.map((s) => ({
        ...s,
        deals: allStageDeals.filter((d) => (moves[d.id] ?? origKeyOf.get(d.id)) === s.key)
      }))
    : data.stages;

  function moveDeal(dealId: string, toKey: string) {
    const currentKey = moves[dealId] ?? origKeyOf.get(dealId);
    if (currentKey === toKey || pendingDealId) return;
    setMoveError(null);
    setMoves((m) => ({ ...m, [dealId]: toKey }));
    setPendingDealId(dealId);
    startMove(async () => {
      const r = await updateDealStage(dealId, toKey);
      setPendingDealId(null);
      if (r.ok) {
        router.refresh();
      } else {
        setMoves((m) => {
          const next = { ...m };
          delete next[dealId];
          return next;
        });
        setMoveError(r.error);
      }
    });
  }

  // Look up the active deal from the server data (real stage for the drawer).
  // Cheap; computed inline each render so a router.refresh() repopulates the
  // drawer immediately.
  let activeDeal: DealDetailData | null = null;
  if (activeDealId) {
    for (const stage of data.stages) {
      const d = stage.deals.find((x) => x.id === activeDealId);
      if (d) {
        activeDeal = {
          id: d.id,
          name: d.name,
          stage: d.stage,
          status: d.status,
          amount: d.amount,
          allocations: d.allocations,
          diligenceRuns: d.diligenceRuns
        };
        break;
      }
    }
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
    { label: 'Visitor → committed', value: `${data.conversionPct}%`, icon: Percent, tone: 'gold' }
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <SectionTitle
        eyebrow="The book · capital formation"
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

      {moveError ? (
        <div
          role="alert"
          className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger"
        >
          Couldn&rsquo;t move the deal: {moveError}
        </div>
      ) : null}

      <RevealGroup className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {summary.map((s) => {
          const Icon = s.icon;
          return (
            <RevealItem key={s.label} whileHover={{ y: -3, transition: FX_SPRING }}>
              <Card className="h-full p-4">
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
            </RevealItem>
          );
        })}
      </RevealGroup>

      <SegTabs
        active={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: 'formation', label: 'Capital formation', icon: Columns3 },
          { id: 'lpmap', label: 'LP Pipeline', icon: Radar },
          { id: 'flow', label: 'Deal flow', icon: ArrowUpRight },
          { id: 'partners', label: 'Partners & services', icon: Briefcase }
        ]}
      />

      {tab === 'formation' && (
        <FormationBoard
          stages={displayStages}
          onSelectDeal={(d) => setActiveDealId(d.id)}
          onMoveDeal={moveDeal}
          pendingDealId={pendingDealId}
        />
      )}
      {tab === 'lpmap' && <LpPipelineBoard data={lpData} />}
      {tab === 'flow' && <DealFlow data={data} />}
      {tab === 'partners' && (
        <PartnersStack partners={data.partners} onAdd={() => setNewPartnerOpen(true)} />
      )}

      <NewDealDrawer open={newDealOpen} onClose={() => setNewDealOpen(false)} />
      <NewPartnerDrawer open={newPartnerOpen} onClose={() => setNewPartnerOpen(false)} />
      <DealDetailDrawer
        open={activeDeal !== null}
        onClose={() => setActiveDealId(null)}
        deal={activeDeal}
      />
    </div>
  );
}
