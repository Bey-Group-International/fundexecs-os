'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  X,
  RotateCcw,
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
import {
  createObjective,
  deleteObjective,
  markObjectiveRead,
  restoreObjective,
  setObjectiveStatus
} from '@/lib/actions/strategy';
import { ObjectiveDrawer, type ObjectiveDraft } from '@/components/drawers/ObjectiveDrawer';

type Tier = '100' | '30' | '10';
type Priority = 'High' | 'Medium' | 'Low';

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  High: 'warning',
  Medium: 'azure',
  Low: 'neutral'
};

// Capital proxy: higher-priority objectives carry more weight in the posture
// rollup, so the plan reflects value at stake — not raw task count. Swaps to
// true dollar-weighting once objectives link to deals (see blueprint Q1).
const PRIORITY_WEIGHT: Record<Priority, number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

/** Priority-weighted average completion across a set of objectives, 0–100. */
function weightedCompletion(list: Array<{ priority: Priority; pct: number }>): number {
  const totalWeight = list.reduce((s, o) => s + PRIORITY_WEIGHT[o.priority], 0);
  if (totalWeight === 0) return 0;
  const earned = list.reduce((s, o) => s + o.pct * PRIORITY_WEIGHT[o.priority], 0);
  return Math.round(earned / totalWeight);
}

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

// Quick-add encodes the chosen horizon in the objective timeline so the loader's
// `deriveTier` reads it back into the same tier (it scans the timeline string).
const TIER_TIMELINE: Record<Tier, string> = {
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
  confirming,
  onAct,
  onRequestDelete,
  onCancelDelete
}: {
  o: StrategyObjective;
  confirming: boolean;
  onAct: (id: string, a: Action) => void;
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
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
      <div className="flex items-center justify-between gap-2">
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

        {confirming ? (
          // Inline confirm — a deliberate two-step so delete is never one click.
          <div className="flex items-center gap-1.5" role="group" aria-label="Confirm delete">
            <span className="text-[11px] font-medium text-fg-3">Delete?</span>
            <button
              type="button"
              onClick={() => onAct(o.id, 'delete')}
              className="flex h-[26px] items-center gap-1 rounded-md border border-[var(--danger-line,var(--gold-line))] bg-surface-1 px-2 text-[11px] font-semibold text-danger transition hover:bg-surface-2"
            >
              <Check size={12} strokeWidth={2} aria-hidden />
              Confirm
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              aria-label="Cancel delete"
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-hairline bg-surface-1 text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex gap-1 opacity-30 transition group-hover:opacity-100 focus-within:opacity-100">
            {ROW_ACTIONS.map(({ act, icon: Icon, label }) => (
              <button
                key={act}
                type="button"
                title={label}
                aria-label={`${label}: ${o.title}`}
                onClick={() => (act === 'delete' ? onRequestDelete(o.id) : onAct(o.id, act))}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-hairline bg-surface-1 text-fg-4 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:opacity-100"
              >
                <Icon size={12} strokeWidth={1.9} aria-hidden />
              </button>
            ))}
          </div>
        )}
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
        <ProgressBar value={o.pct} color={color} height={5} ariaLabel={`Progress on ${o.title}`} />
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

/** A transient bottom flash: a status line with an optional Undo. */
interface Flash {
  message: string;
  undoId?: string;
}

export function StrategyView({ initialObjectives }: { initialObjectives: StrategyObjective[] }) {
  // Objectives created via quick-add live here optimistically until the next
  // server render reconciles them; prepended so new items show at the top.
  const [extra, setExtra] = useState<StrategyObjective[]>([]);
  const source = useMemo(() => [...extra, ...initialObjectives], [extra, initialObjectives]);

  const [patches, setPatches] = useState<
    Record<string, { read?: boolean; archived?: boolean; closed?: boolean; deleted?: boolean }>
  >({});
  const patch = (id: string, next: (typeof patches)[string]) =>
    setPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));

  const [tier, setTier] = useState<'all' | Tier>('all');
  const [drafts, setDrafts] = useState<Record<Tier, string>>({ '100': '', '30': '', '10': '' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInitial, setDrawerInitial] = useState<ObjectiveDraft | null>(null);
  // Monotonic counter for optimistic temp ids — avoids impure Date.now() in render.
  const tempSeq = useRef(0);

  // Auto-dismiss the flash so the undo affordance never lingers.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  function act(id: string, a: Action) {
    setConfirmId(null);
    if (a === 'delete') {
      patch(id, { deleted: true });
      setFlash({ message: 'Objective deleted', undoId: id });
      void deleteObjective(id);
    } else if (a === 'done') {
      patch(id, { read: true, closed: true });
      // Completing an objective advances the Execution layer of Chain of Trust.
      window.emitTrust?.({
        layer: 'execution',
        title: 'Objective complete',
        msg: 'An objective in the 100 / 30 / 10 plan was marked complete.',
        pct: 100,
        entity: id
      });
      void setObjectiveStatus(id, 'completed');
    } else if (a === 'read') {
      patch(id, { read: true });
      void markObjectiveRead(id);
    } else if (a === 'archive') {
      patch(id, { archived: true, read: true });
      setFlash({ message: 'Objective archived', undoId: id });
      void setObjectiveStatus(id, 'archived');
    }
  }

  function undo(id: string) {
    patch(id, { deleted: false, archived: false, closed: false });
    setFlash(null);
    void restoreObjective(id);
  }

  function quickAdd(t: Tier) {
    const title = drafts[t].trim();
    if (!title) return;
    setDrafts((prev) => ({ ...prev, [t]: '' }));

    const tempId = `tmp-${(tempSeq.current += 1)}`;
    const optimistic: StrategyObjective = {
      id: tempId,
      planId: '',
      tier: t,
      title,
      timeline: TIER_TIMELINE[t],
      owner: null,
      priority: 'Medium',
      pct: 0,
      read: true,
      state: 'open',
      ai: null
    };
    setExtra((prev) => [optimistic, ...prev]);

    void createObjective({
      objective: title,
      timeline: TIER_TIMELINE[t],
      priority: 'medium'
    }).then((res) => {
      if (res.ok) {
        // Swap the temp id for the real one so future actions hit the DB row.
        setExtra((prev) => prev.map((e) => (e.id === tempId ? { ...e, id: res.objective.id } : e)));
      } else {
        setExtra((prev) => prev.filter((e) => e.id !== tempId));
        setFlash({ message: res.error || 'Could not add objective' });
      }
    });
  }

  function openNew() {
    setDrawerInitial(null);
    setDrawerOpen(true);
  }

  // Project the shared card flags back onto each objective's display shape:
  // a closed card reads as "done" (100%), an archived card drops out.
  const objectives = source
    .map((o) => ({ o, p: patches[o.id] ?? {} }))
    .filter(
      ({ o, p }) => !(p.deleted ?? false) && !(o.state === 'archived' && p.archived !== false)
    )
    .map(({ o, p }) => {
      const archived = p.archived ?? o.state === 'archived';
      const closed = p.closed ?? o.state === 'done';
      return {
        ...o,
        read: p.read ?? o.read,
        state: archived ? ('archived' as const) : closed ? ('done' as const) : ('open' as const),
        pct: closed ? 100 : o.pct
      };
    });

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
          <Button variant="primary" icon={Plus} onClick={openNew} data-testid="strategy-new">
            New objective
          </Button>
        </div>
      </div>

      <Card className="p-4">
        {/* Overall posture — priority-weighted so the number reflects value at
            stake, not task count. The seam for the full Institutional Posture
            scorecard (Compliance · Governance · Execution · Capital) — see
            memory/STRATEGY_COMPOUNDING_BLUEPRINT.md. */}
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-hairline pb-3.5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Execution posture
            </span>
            <span className="text-[11px] text-fg-5">capital-weighted across all horizons</span>
          </div>
          <span className="text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-gold-1">
            {weightedCompletion(active)}%
          </span>
        </div>

        <div className="grid gap-6 pt-4 sm:grid-cols-3">
          {TIER_ORDER.map((t) => {
            const list = active.filter((o) => o.tier === t);
            const avg = weightedCompletion(list);
            return (
              <div key={t} className="flex flex-col">
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
                <ProgressBar
                  value={avg}
                  color={TIER_COLOR[t]}
                  height={5}
                  ariaLabel={`Capital-weighted completion for ${t}`}
                />

                {/* Inline quick-add — capture an objective straight into this
                    horizon without opening the drawer. */}
                <form
                  className="mt-3 flex items-center gap-1.5 rounded-md border border-hairline bg-surface-1 px-2 py-1 transition focus-within:border-azure-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    quickAdd(t);
                  }}
                >
                  <Plus size={12} strokeWidth={2} className="flex-none text-fg-4" aria-hidden />
                  <input
                    value={drafts[t]}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [t]: e.target.value }))}
                    placeholder={`Quick add ${TIER_LABEL[t]}`}
                    aria-label={`Quick add a ${TIER_LABEL[t]} objective`}
                    data-testid={`strategy-quickadd-${t}`}
                    className="min-w-0 flex-1 bg-transparent text-[11.5px] text-fg-1 placeholder:text-fg-5 focus:outline-none"
                  />
                </form>
              </div>
            );
          })}
        </div>
      </Card>

      {active.length === 0 ? (
        // First-run: no objectives anywhere — invite the member to start a plan.
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <EarnCoin size={44} glow />
          <h3 className="text-[15px] font-semibold text-fg-1">Build your first objective</h3>
          <p className="max-w-md text-[12.5px] leading-relaxed text-fg-4">
            The 100 / 30 / 10 plan turns your strategy into execution: 100-day bets, 30-day
            milestones, and 10-day moves. Earn will track progress and recommend next steps.
          </p>
          <Button variant="primary" icon={Plus} onClick={openNew} data-testid="strategy-empty-new">
            New objective
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          {visible.length ? (
            visible.map((o) => (
              <ObjectiveCard
                key={o.id}
                o={o}
                confirming={confirmId === o.id}
                onAct={act}
                onRequestDelete={setConfirmId}
                onCancelDelete={() => setConfirmId(null)}
              />
            ))
          ) : (
            <Card className="col-span-full flex flex-col items-center gap-3 p-10 text-center">
              <p className="text-[13px] text-fg-4">
                No objectives in the {tier === 'all' ? 'plan' : `${TIER_LABEL[tier]} horizon`} yet.
              </p>
              <div className="flex items-center gap-2.5">
                {tier !== 'all' ? (
                  <Button variant="secondary" onClick={() => setTier('all')}>
                    View all horizons
                  </Button>
                ) : null}
                <Button variant="primary" icon={Plus} onClick={openNew}>
                  New objective
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Undo / status flash. role=status + aria-live so it's announced. */}
      {flash && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-3 rounded-[10px] border border-hairline bg-surface-1 px-4 py-2.5"
        >
          <span className="text-[12px] text-fg-2">{flash.message}</span>
          {flash.undoId && (
            <button
              type="button"
              onClick={() => undo(flash.undoId as string)}
              className="flex items-center gap-1.5 rounded-md border border-hairline bg-surface-2 px-2.5 py-1 text-[11.5px] font-semibold text-fg-1 transition hover:bg-surface-3"
            >
              <RotateCcw size={12} strokeWidth={2} aria-hidden />
              Undo
            </button>
          )}
        </div>
      )}

      <ObjectiveDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initial={drawerInitial}
      />
    </div>
  );
}
