'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  FileSearch,
  HandCoins,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { updateDealStage } from '@/lib/actions/deals';
import { compactMoney } from '@/lib/format';
import type { PipelineDeal, PipelineStage } from '@/lib/queries/pipeline';
import { cn } from '@/lib/utils';

/* ── stage vocabulary over the canonical formation stages ────────────────── */

const STAGE_TONE: Record<string, BadgeTone> = {
  visitor: 'neutral',
  prospect: 'neutral',
  qualified: 'azure',
  meeting: 'azure',
  diligence: 'info',
  'soft-circle': 'gold',
  committed: 'gold',
  closed: 'success'
};

const STAGE_BAR: Record<string, string> = {
  visitor: 'var(--fg-4)',
  prospect: 'var(--fg-4)',
  qualified: 'var(--azure-1)',
  meeting: 'var(--azure-1)',
  diligence: 'var(--info)',
  'soft-circle': 'var(--gold-1)',
  committed: 'var(--gold-1)',
  closed: 'var(--success)'
};

/** Earn's next move per stage: label + the stage the approve advances to. */
const NEXT_MOVE: Record<
  string,
  { label: string; to: string; steps: string[]; draft: (name: string) => string }
> = {
  visitor: {
    label: 'Qualify the lead',
    to: 'prospect',
    steps: [
      'Pull the inbound context',
      'Score it against your mandate',
      'Draft the qualification note',
      'Prepare for your approval'
    ],
    draft: (n) =>
      `A qualification read on ${n} — mandate fit, size, and what to confirm first. Approving moves it to Prospect on your pipeline.`
  },
  prospect: {
    label: 'Confirm the mandate fit',
    to: 'qualified',
    steps: [
      'Cross-check thesis, stage and size',
      'Flag the open questions',
      'Draft the fit summary',
      'Prepare for your approval'
    ],
    draft: (n) =>
      `The fit summary for ${n} — where it matches your thesis and the two questions worth asking before a meeting. Approving marks it Qualified.`
  },
  qualified: {
    label: 'Book the meeting',
    to: 'meeting',
    steps: [
      'Draft the outreach',
      'Propose call windows',
      'Attach your one-pager',
      'Prepare for your approval'
    ],
    draft: (n) =>
      `The meeting request for ${n} with proposed windows and your one-pager attached. Approving moves it to Meeting.`
  },
  meeting: {
    label: 'Open diligence',
    to: 'diligence',
    steps: [
      'Assemble the document request list',
      'Stage the diligence workspace',
      'Sequence the workstreams',
      'Prepare for your approval'
    ],
    draft: (n) =>
      `The diligence kickoff for ${n} — document request list and sequenced workstreams. Approving opens Diligence.`
  },
  diligence: {
    label: 'Move to soft-circle',
    to: 'soft-circle',
    steps: [
      'Summarize the diligence read',
      'Draft the soft-circle terms',
      'Cross-check your mandate',
      'Prepare for your approval'
    ],
    draft: (n) =>
      `The soft-circle package for ${n} — diligence summary and proposed terms. Approving marks it Soft circle.`
  },
  'soft-circle': {
    label: 'Lock the commitment',
    to: 'committed',
    steps: [
      'Confirm the circled amount',
      'Prepare the commitment summary',
      'Stage the closing checklist',
      'Prepare for your approval'
    ],
    draft: (n) =>
      `The commitment summary for ${n} with the closing checklist staged. Approving marks it Committed.`
  },
  committed: {
    label: 'Drive the close',
    to: 'closed',
    steps: [
      'Verify signatures and conditions',
      'Stage the funding flow',
      'Prepare the closing record',
      'Prepare for your approval'
    ],
    draft: (n) =>
      `The closing package for ${n} — conditions verified and the record prepared. Approving marks it Closed and logs the win to your Chain of Trust.`
  }
};

function fitColor(f: number): string {
  return f >= 85 ? 'var(--success)' : f >= 75 ? 'var(--gold-1)' : 'var(--fg-3)';
}

/* ── the deal detail drawer ──────────────────────────────────────────────── */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function DealDrawer({
  deal,
  stages,
  onClose,
  onRun
}: {
  deal: PipelineDeal;
  stages: PipelineStage[];
  onClose: () => void;
  onRun: (deal: PipelineDeal) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [onClose]);

  const stageKeys = stages.map((s) => s.key);
  const at = stageKeys.indexOf(deal.stage);
  const stageLabel = stages.find((s) => s.key === deal.stage)?.label ?? deal.stage;
  const move = NEXT_MOVE[deal.stage] ?? null;
  const latestRun = deal.diligenceRuns[0] ?? null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-[rgba(3,6,12,0.64)] backdrop-blur-[3px]"
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={deal.name}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[420px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
            <Building2 size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15.5px] font-semibold text-fg-1">{deal.name}</div>
            <div className="text-[11.5px] text-fg-4">{deal.note}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Size</div>
              <div className="mt-1 text-[15px] font-semibold text-gold-1 [font-feature-settings:'tnum']">
                {deal.amount ? compactMoney(deal.amount) : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Fit</div>
              <div
                className="mt-1 text-[16px] font-semibold [font-feature-settings:'tnum']"
                style={{ color: fitColor(deal.fit) }}
              >
                {deal.fit}
              </div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Stage</div>
              <Badge
                tone={STAGE_TONE[deal.stage] ?? 'neutral'}
                className="mt-1.5 px-2 py-0.5 text-[9.5px]"
              >
                {stageLabel}
              </Badge>
            </div>
          </div>

          {/* stage tracker */}
          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Pipeline stage
            </div>
            <div className="flex items-center gap-1">
              {stages.map((s, i) => (
                <div key={s.key} className="flex-1 text-center">
                  <div
                    className="h-1 rounded-full"
                    style={{
                      background:
                        at >= 0 && i <= at
                          ? (STAGE_BAR[deal.stage] ?? 'var(--accent)')
                          : 'var(--surface-3)'
                    }}
                  />
                  <div
                    className={cn(
                      'mt-1 truncate text-[8.5px]',
                      i === at ? 'text-fg-2' : 'text-fg-5'
                    )}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* real evidence: allocations + diligence */}
          {(deal.allocations.length > 0 || latestRun) && (
            <div className="flex flex-col gap-2">
              {deal.allocations.length > 0 && (
                <div className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5 text-[12px] text-fg-2">
                  <HandCoins size={15} className="flex-none text-gold-1" aria-hidden />
                  {deal.allocations.length} allocation{deal.allocations.length === 1 ? '' : 's'}{' '}
                  logged · {compactMoney(deal.allocations.reduce((s, a) => s + (a.amount ?? 0), 0))}
                </div>
              )}
              {latestRun && (
                <div className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5 text-[12px] text-fg-2">
                  <FileSearch size={15} className="flex-none text-azure-1" aria-hidden />
                  Diligence {latestRun.status}
                  {latestRun.conviction != null ? ` · conviction ${latestRun.conviction}` : ''}
                </div>
              )}
            </div>
          )}

          {move ? (
            <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
              <div className="mb-2 flex items-center gap-2">
                <EarnCoin size={24} />
                <span className="text-[12.5px] font-semibold text-gold-1">
                  Earn&apos;s next move
                </span>
              </div>
              <div className="mb-3 text-[12px] leading-relaxed text-fg-2">
                {move.label} — I&apos;ll assemble the package and cross-check your thesis, then
                queue it for your approval.
              </div>
              <Button
                variant="gold"
                size="sm"
                icon={Sparkles}
                className="w-full"
                onClick={() => onRun(deal)}
              >
                {move.label} with Earn
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
              <CheckCircle2 size={17} aria-hidden />
              Closed{deal.amount ? ` · ${compactMoney(deal.amount)}` : ''} — on your record
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── the pipeline ────────────────────────────────────────────────────────── */

export interface DealPipelineFlowProps {
  stages: PipelineStage[];
  pipelineValue: number;
  committed: number;
}

export function DealPipelineFlow({
  stages: initialStages,
  pipelineValue,
  committed
}: DealPipelineFlowProps) {
  const [stages, setStages] = useState(initialStages);
  const [openId, setOpenId] = useState<string | null>(null);
  const [running, setRunning] = useState<PipelineDeal | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const deals = stages.flatMap((s) => s.deals);
  const stageKeys = stages.map((s) => s.key);
  const openDeal = openId ? (deals.find((d) => d.id === openId) ?? null) : null;
  const move = running ? (NEXT_MOVE[running.stage] ?? null) : null;

  function applyAdvance(deal: PipelineDeal, to: string) {
    setStages((prev) =>
      prev.map((s) => ({
        ...s,
        deals:
          s.key === to
            ? [...s.deals, { ...deal, stage: to }]
            : s.deals.filter((d) => d.id !== deal.id)
      }))
    );
    const label = stages.find((s) => s.key === to)?.label ?? to;
    setToast(`${deal.name} advanced to ${label}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <TrendingUp size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Deal pipeline
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Sourced and scored by Marcus — every advance drafted by Earn, executed on your
              approval.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
            <div className="text-[11px] text-fg-4">In pipeline</div>
            <div className="mt-1.5 text-[21px] font-semibold text-azure-1 [font-feature-settings:'tnum']">
              {deals.length}
            </div>
            <div className="mt-0.5 text-[10.5px] text-fg-5">on-thesis deals</div>
          </div>
          <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
            <div className="text-[11px] text-fg-4">Pipeline value</div>
            <div className="mt-1.5 text-[21px] font-semibold text-gold-1 [font-feature-settings:'tnum']">
              {compactMoney(pipelineValue)}
            </div>
            <div className="mt-0.5 text-[10.5px] text-fg-5">total deal size</div>
          </div>
          <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
            <div className="text-[11px] text-fg-4">Committed</div>
            <div className="mt-1.5 text-[21px] font-semibold text-success [font-feature-settings:'tnum']">
              {compactMoney(committed)}
            </div>
            <div className="mt-0.5 text-[10.5px] text-fg-5">signed or closed</div>
          </div>
        </div>
      </Card>

      {/* stage funnel */}
      <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
        {stages.map((s) => (
          <div
            key={s.key}
            className="rounded-xl border border-hairline bg-surface-1 px-2.5 py-2"
            style={{ borderTopWidth: 2, borderTopColor: STAGE_BAR[s.key] ?? 'var(--fg-4)' }}
          >
            <div className="truncate text-[10px] text-fg-4">{s.label}</div>
            <div className="mt-0.5 text-[16px] font-semibold [font-feature-settings:'tnum']">
              {s.deals.length}
            </div>
          </div>
        ))}
      </div>

      {/* deal cards */}
      {deals.length === 0 ? (
        <Card className="p-8 text-center">
          <TrendingUp size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">Nothing in the pipeline yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Marcus scores every deal that lands against your mandate — the strongest surface here
            first, and every advance routes through your approval.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {deals
            .slice()
            .sort(
              (a, b) => stageKeys.indexOf(b.stage) - stageKeys.indexOf(a.stage) || b.fit - a.fit
            )
            .map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setOpenId(d.id)}
                className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-left transition hover:bg-surface-2"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                    <Building2 size={16} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{d.name}</div>
                    <div className="truncate text-[10.5px] text-fg-5">{d.note}</div>
                  </div>
                  <Badge
                    tone={STAGE_TONE[d.stage] ?? 'neutral'}
                    className="px-2 py-0.5 text-[9.5px]"
                  >
                    {stages.find((s) => s.key === d.stage)?.label ?? d.stage}
                  </Badge>
                </div>
                <div className="mt-2.5 flex items-center gap-3.5 text-[11px] text-fg-4">
                  <span>
                    Size{' '}
                    <b className="font-mono text-fg-2 [font-feature-settings:'tnum']">
                      {d.amount ? compactMoney(d.amount) : '—'}
                    </b>
                  </span>
                  <span>
                    Fit <b style={{ color: fitColor(d.fit) }}>{d.fit}</b>
                  </span>
                </div>
              </button>
            ))}
        </div>
      )}

      {/* Earn's standing note */}
      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Tap a deal and I&apos;ll draft the next advance —
          qualification through close. Nothing moves until you approve.
        </p>
      </Card>

      {openDeal && (
        <DealDrawer
          deal={openDeal}
          stages={stages}
          onClose={() => setOpenId(null)}
          onRun={(d) => {
            setOpenId(null);
            setRunning(d);
          }}
        />
      )}

      {running && move && (
        <ActionRunner
          title={`${move.label} — ${running.name}`}
          steps={move.steps}
          draftTitle={`${move.label} · ${running.name}`}
          draft={move.draft(running.name)}
          onApprove={async () => {
            const res = await updateDealStage(running.id, move.to);
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunning(null)}
          onApplied={() => applyAdvance(running, move.to)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2.5 rounded-[14px] border border-[var(--success-line)] bg-bg-2 px-4 py-3 shadow-[var(--shadow-lg)]">
          <ShieldCheck size={17} className="text-success" aria-hidden />
          <div>
            <div className="text-[13px] font-semibold text-fg-1">Earn completed an action</div>
            <div className="text-[11.5px] text-fg-4">{toast}</div>
          </div>
        </div>
      )}
    </div>
  );
}
