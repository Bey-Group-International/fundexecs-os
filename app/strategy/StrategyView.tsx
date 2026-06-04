'use client';

import { useState } from 'react';
import {
  Plus,
  Calendar,
  User,
  CircleDashed,
  Sparkles,
  Check,
  Eye,
  Archive,
  Trash2,
  type LucideIcon
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionTitle,
  SegTabs,
  type BadgeTone
} from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import type { StrategyObjective } from '@/lib/queries/strategy';

type Tier = '100' | '30' | '10';
type Priority = 'High' | 'Medium' | 'Low';

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  High: 'warning',
  Medium: 'azure',
  Low: 'neutral'
};

const TIER_COLOR: Record<Tier, string> = {
  '100': 'var(--gold-1)',
  '30': 'var(--azure-1)',
  '10': 'var(--success)'
};

const TIER_LABEL: Record<Tier, string> = {
  '100': '100-day',
  '30': '30-day',
  '10': '10-day'
};

const TIER_ORDER: Tier[] = ['100', '30', '10'];

type Action = 'done' | 'read' | 'archive' | 'delete';

const ROW_ACTIONS: Array<{ act: Action; icon: LucideIcon; label: string }> = [
  { act: 'done', icon: Check, label: 'Mark complete' },
  { act: 'read', icon: Eye, label: 'Mark read' },
  { act: 'archive', icon: Archive, label: 'Archive' },
  { act: 'delete', icon: Trash2, label: 'Delete' }
];

function ObjectiveCard({
  o,
  onAct
}: {
  o: StrategyObjective;
  onAct: (id: string, a: Action) => void;
}) {
  const color = TIER_COLOR[o.tier];
  const done = o.state === 'done';
  return (
    <Card
      className={cn(
        'group p-4',
        !o.read && 'border-[var(--gold-line)] bg-[rgba(247,201,72,0.05)]',
        done && 'opacity-60'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="rounded-md border bg-white/[0.05] px-2 py-0.5 font-mono text-[12px] font-semibold tabular-nums"
            style={{ color, borderColor: color }}
          >
            {o.tier}
          </span>
          {!o.read && <span className="h-1.5 w-1.5 rounded-full bg-gold-1" aria-hidden />}
          <Badge tone={PRIORITY_TONE[o.priority]} className="text-[10px]">
            {o.priority} priority
          </Badge>
        </div>
        <div className="flex gap-1 opacity-30 transition group-hover:opacity-100">
          {ROW_ACTIONS.map(({ act, icon: Icon, label }) => (
            <button
              key={act}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => onAct(o.id, act)}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-hairline bg-surface-1 text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <Icon size={12} strokeWidth={1.9} aria-hidden />
            </button>
          ))}
        </div>
      </div>

      <div className={cn('mt-3 text-[14.5px] font-semibold text-fg-1', done && 'line-through')}>
        {o.title}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-fg-4">
        <span className="flex items-center gap-1.5">
          <Calendar size={13} strokeWidth={1.9} aria-hidden />
          {o.timeline ?? '—'}
        </span>
        {o.owner && (
          <span className="flex items-center gap-1.5">
            <User size={13} strokeWidth={1.9} aria-hidden />
            {o.owner}
          </span>
        )}
        <span className="flex items-center gap-1.5 tabular-nums">
          <CircleDashed size={13} strokeWidth={1.9} aria-hidden />
          {o.pct}%
        </span>
      </div>

      <div className="mt-2.5">
        <ProgressBar value={o.pct} color={color} height={5} />
      </div>

      {o.ai && (
        <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-[var(--azure-line)] bg-[var(--azure-soft)] px-3 py-2">
          <Sparkles
            size={13}
            strokeWidth={1.9}
            className="mt-px flex-none text-azure-1"
            aria-hidden
          />
          <span className="text-[11.5px] leading-relaxed text-fg-2">
            <span className="font-semibold text-azure-1">Earn recommends:</span> {o.ai}
          </span>
        </div>
      )}
    </Card>
  );
}

export function StrategyView({ initialObjectives }: { initialObjectives: StrategyObjective[] }) {
  const [objectives, setObjectives] = useState<StrategyObjective[]>(initialObjectives);
  const [tier, setTier] = useState<'all' | Tier>('all');

  function act(id: string, a: Action) {
    setObjectives((prev) =>
      prev.flatMap((o) => {
        if (o.id !== id) return [o];
        if (a === 'delete') return [];
        if (a === 'done') return [{ ...o, state: 'done', pct: 100, read: true }];
        if (a === 'read') return [{ ...o, read: true }];
        if (a === 'archive') return [{ ...o, state: 'archived', read: true }];
        return [o];
      })
    );
  }

  const active = objectives.filter((o) => o.state !== 'archived');
  const visible = active.filter((o) => tier === 'all' || o.tier === tier);

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle
          eyebrow="Operating cadence"
          title="100 / 30 / 10 Strategy Plan"
          className="mb-0"
        />
        <div className="flex items-center gap-2.5">
          <SegTabs
            active={tier}
            onChange={(id) => setTier(id as 'all' | Tier)}
            tabs={[
              { id: 'all', label: 'All' },
              { id: '100', label: '100-day' },
              { id: '30', label: '30-day' },
              { id: '10', label: '10-day' }
            ]}
          />
          <Button variant="primary" icon={Plus}>
            New objective
          </Button>
        </div>
      </div>

      <Card className="flex items-center gap-4 bg-[linear-gradient(100deg,rgba(247,201,72,0.08),transparent_58%)] px-[18px] py-3.5">
        <EarnCoin size={36} glow />
        <div className="min-w-0 flex-1 text-[13px] text-fg-2">
          <span className="font-semibold text-fg-1">Earnest Fundmaker</span>, your private market
          assistant, is tracking your plan —{' '}
          <span className="font-semibold text-gold-1">
            {active.length} {active.length === 1 ? 'objective' : 'objectives'}
          </span>{' '}
          across the 100 / 30 / 10 horizons.
        </div>
        <Badge tone="gold" dot className="flex-none">
          Execution ready
        </Badge>
      </Card>

      <Card className="grid gap-6 p-4 sm:grid-cols-3">
        {TIER_ORDER.map((t) => {
          const list = active.filter((o) => o.tier === t);
          const avg = list.length
            ? Math.round(list.reduce((s, o) => s + o.pct, 0) / list.length)
            : 0;
          return (
            <div key={t}>
              <div className="flex items-baseline gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                  {TIER_LABEL[t]} horizon
                </span>
                <span className="text-[11px] tabular-nums text-fg-5">
                  {list.length} {list.length === 1 ? 'objective' : 'objectives'}
                </span>
              </div>
              <div
                className="my-2 text-[28px] font-semibold tabular-nums tracking-[-0.02em]"
                style={{ color: TIER_COLOR[t] }}
              >
                {avg}%
              </div>
              <ProgressBar value={avg} color={TIER_COLOR[t]} height={5} />
            </div>
          );
        })}
      </Card>

      <div className="grid gap-3.5 lg:grid-cols-2">
        {visible.length ? (
          visible.map((o) => <ObjectiveCard key={o.id} o={o} onAct={act} />)
        ) : (
          <Card className="col-span-full p-10 text-center text-[13px] text-fg-5">
            No objectives in this horizon.
          </Card>
        )}
      </div>
    </div>
  );
}
