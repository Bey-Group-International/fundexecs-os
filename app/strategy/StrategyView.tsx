'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCardState } from '@/lib/ui/useCardState';
import {
  Plus,
  Calendar,
  Compass,
  User,
  CircleDashed,
  Sparkles,
  Check,
  Eye,
  Archive,
  Trash2,
  Unlock,
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
  approveDraftObjective,
  completeObjective,
  deleteObjective,
  markObjectiveRead,
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

const TIER_ORDER: Tier[] = ['100', '30', '10'];

type Action = 'done' | 'read' | 'archive' | 'delete';

const ROW_ACTIONS: Array<{ act: Action; icon: LucideIcon; label: string }> = [
  { act: 'done', icon: Check, label: 'Mark complete' },
  { act: 'read', icon: Eye, label: 'Mark read' },
  { act: 'archive', icon: Archive, label: 'Archive' },
  { act: 'delete', icon: Trash2, label: 'Delete' }
];

const SOURCE_LABEL: Record<StrategyObjective['source'], string> = {
  manual: 'Manual',
  signal: 'Signal draft',
  lifecycle: 'Lifecycle draft',
  cascade: 'Cascade draft'
};

/**
 * A single objective card: title, tier/source badges, progress, and the row
 * action menu (complete / read / archive / delete) plus draft approval.
 */
function ObjectiveCard({
  o,
  onAct,
  onApprove
}: {
  o: StrategyObjective;
  onAct: (id: string, a: Action) => void;
  onApprove: (id: string) => void;
}) {
  const color = TIER_COLOR[o.tier];
  const done = o.state === 'done';
  const draft = o.isDraft;
  return (
    <Card
      className={cn(
        'group p-4',
        // Drafts read as dashed/azure "proposed" cards — visually distinct from
        // accepted objectives until the operator approves them into the plan.
        draft && 'border-dashed border-[var(--azure-line)] bg-[var(--azure-soft)]',
        !draft && !o.read && 'border-[var(--gold-line)] bg-[rgba(247,201,72,0.05)]',
        done && 'opacity-60'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-md border bg-white/[0.05] px-2 py-0.5 font-mono text-[12px] font-semibold tabular-nums"
            style={{ color, borderColor: color }}
          >
            {o.tier}
          </span>
          {draft ? (
            <Badge tone="azure" className="text-[10px]">
              {SOURCE_LABEL[o.source]} · proposed
            </Badge>
          ) : (
            <>
              {!o.read && <span className="h-1.5 w-1.5 rounded-full bg-gold-1" aria-hidden />}
              <Badge tone={PRIORITY_TONE[o.priority]} className="text-[10px]">
                {o.priority} priority
              </Badge>
            </>
          )}
        </div>
        {!draft && (
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

      {!draft && (
        <div className="mt-2.5">
          <ProgressBar
            value={o.pct}
            color={color}
            height={5}
            ariaLabel={`Progress on ${o.title}`}
          />
        </div>
      )}

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

      {draft && (
        // "Earn drafts, you approve" — a proposed objective stays out of the
        // posture rollup until the operator approves it into the live plan.
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3">
          <span className="text-[11px] text-fg-4">
            Earn drafted this from your live signals — approve to add it to the plan.
          </span>
          <div className="flex flex-none items-center gap-2">
            <Button
              variant="ghost"
              className="h-[28px] px-2.5 text-[12px]"
              onClick={() => onAct(o.id, 'archive')}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              icon={Check}
              className="h-[28px] px-2.5 text-[12px]"
              onClick={() => onApprove(o.id)}
              data-testid="strategy-approve-draft"
            >
              Approve
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Client view for the 100/30/10 operating plan: groups objectives by tier, shows
 * priority-weighted completion, and wires optimistic row actions / draft approval
 * back to the server actions.
 */
export function StrategyView({ initialObjectives }: { initialObjectives: StrategyObjective[] }) {
  const cards = useCardState(initialObjectives, (o) => ({
    read: o.read,
    archived: o.state === 'archived',
    closed: o.state === 'done'
  }));
  const [tier, setTier] = useState<'all' | Tier>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInitial, setDrawerInitial] = useState<ObjectiveDraft | null>(null);
  // Locally-approved draft ids — flips a card from "proposed" to accepted before
  // the server refresh lands, so the approval feels instant.
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  // A gate-unlock celebration line surfaced after a completion flips a gate.
  const [gateUnlock, setGateUnlock] = useState<string | null>(null);
  const router = useRouter();

  function act(id: string, a: Action) {
    if (a === 'delete') {
      cards.delete(id);
      void deleteObjective(id).then(() => router.refresh());
    } else if (a === 'done') {
      cards.complete(id);
      // Completing an objective advances the Execution layer of Chain of Trust.
      window.emitTrust?.({
        layer: 'execution',
        title: 'Objective complete',
        msg: 'An objective in the 100 / 30 / 10 plan was marked complete.',
        pct: 100,
        entity: id
      });
      // completeObjective also cascades the next-tier draft and detects whether
      // this completion unlocked the next lifecycle gate.
      void completeObjective(id).then((res) => {
        if (res.ok && res.gateUnlock) setGateUnlock(res.gateUnlock.message);
        router.refresh();
      });
    } else if (a === 'read') {
      cards.markRead(id);
      void markObjectiveRead(id).then(() => router.refresh());
    } else if (a === 'archive') {
      cards.archive(id);
      void setObjectiveStatus(id, 'archived').then(() => router.refresh());
    }
  }

  function approve(id: string) {
    // Accept a specialist/signal draft into the live plan. Optimistically flip
    // it to accepted; the server stamps approved_at under RLS.
    setApprovedIds((prev) => new Set(prev).add(id));
    cards.markRead(id);
    void approveDraftObjective(id).then(() => router.refresh());
  }

  function openNew() {
    setDrawerInitial(null);
    setDrawerOpen(true);
  }

  // Project the shared card flags back onto each objective's display shape:
  // a closed card reads as "done" (100%), an archived card drops out. A locally
  // approved draft is no longer a draft (enters the plan immediately).
  const objectives = cards.items
    .filter((o) => !o.deleted)
    .map((o) => ({
      ...o,
      state: o.archived ? ('archived' as const) : o.closed ? ('done' as const) : ('open' as const),
      pct: o.closed ? 100 : o.pct,
      isDraft: o.isDraft && !approvedIds.has(o.id)
    }));

  const active = objectives.filter((o) => o.state !== 'archived');
  // Drafts are proposed, not yet in the plan — they don't count toward the
  // capital-weighted posture rollup until approved.
  const accepted = active.filter((o) => !o.isDraft);
  const drafts = active.filter((o) => o.isDraft);
  const visible = active.filter((o) => tier === 'all' || o.tier === tier);

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]"
            aria-hidden
          >
            <Compass size={21} strokeWidth={1.9} />
          </span>
          <SectionTitle
            eyebrow="Operating cadence"
            title="100 / 30 / 10 Strategy Plan"
            className="mb-0"
          />
        </div>
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

      <Card className="flex items-center gap-4 bg-[linear-gradient(100deg,rgba(247,201,72,0.08),transparent_58%)] px-[18px] py-3.5">
        <EarnCoin size={36} glow />
        <div className="min-w-0 flex-1 text-[13px] text-fg-2">
          <span className="font-semibold text-fg-1">Earnest Fundmaker</span>, your private market
          assistant, is tracking your plan —{' '}
          <span className="font-semibold text-gold-1">
            {accepted.length} {accepted.length === 1 ? 'objective' : 'objectives'}
          </span>{' '}
          across the 100 / 30 / 10 horizons
          {drafts.length > 0 && (
            <>
              {' '}
              · <span className="font-semibold text-azure-1">{drafts.length} drafted</span> awaiting
              your approval
            </>
          )}
          .
        </div>
        <Badge tone="gold" dot className="flex-none">
          Execution ready
        </Badge>
      </Card>

      {gateUnlock && (
        // Compounding celebration — a completion that flipped a lifecycle gate
        // surfaces the stage it unlocked.
        <Card className="flex items-center gap-3 border-[var(--success-line,var(--azure-line))] bg-[var(--azure-soft)] px-[18px] py-3">
          <Unlock size={16} strokeWidth={1.9} className="flex-none text-azure-1" aria-hidden />
          <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-fg-1">{gateUnlock}</span>
          <button
            type="button"
            onClick={() => setGateUnlock(null)}
            className="flex-none rounded-md border border-hairline bg-surface-1 px-2 py-0.5 text-[11px] text-fg-4 transition hover:text-fg-1"
          >
            Dismiss
          </button>
        </Card>
      )}

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
            {weightedCompletion(accepted)}%
          </span>
        </div>

        <div className="grid gap-6 pt-4 sm:grid-cols-3">
          {TIER_ORDER.map((t) => {
            const list = accepted.filter((o) => o.tier === t);
            const avg = weightedCompletion(list);
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
                <ProgressBar
                  value={avg}
                  color={TIER_COLOR[t]}
                  height={5}
                  ariaLabel={`Capital-weighted completion for ${t}`}
                />
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
            visible.map((o) => <ObjectiveCard key={o.id} o={o} onAct={act} onApprove={approve} />)
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

      <ObjectiveDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initial={drawerInitial}
      />
    </div>
  );
}
