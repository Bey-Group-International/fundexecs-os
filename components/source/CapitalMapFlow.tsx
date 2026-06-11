'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Landmark, ShieldCheck, Sparkles, X } from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { updateLpStage } from '@/lib/actions/lp-pipeline';
import { compactMoney } from '@/lib/format';
import { LP_STAGES, type LpEntry, type LpStageKey } from '@/lib/pipeline/lp-stages';
import { cn } from '@/lib/utils';

/* ── stage vocabulary (the prototype's, over the real canonical stages) ──── */

const STAGE_TONE: Record<LpStageKey, BadgeTone> = {
  prospect: 'neutral',
  contacted: 'azure',
  soft_circled: 'gold',
  committed: 'success'
};

const STAGE_BAR: Record<LpStageKey, string> = {
  prospect: 'var(--fg-4)',
  contacted: 'var(--azure-1)',
  soft_circled: 'var(--gold-1)',
  committed: 'var(--success)'
};

/** Earn's next move per stage: label + the stage the approve advances to. */
const NEXT_MOVE: Record<
  Exclude<LpStageKey, 'committed'>,
  { label: string; to: LpStageKey; steps: string[]; draft: (name: string) => string }
> = {
  prospect: {
    label: 'Draft the intro',
    to: 'contacted',
    steps: [
      'Pull their stated focus and your fund story',
      'Personalize the introduction',
      'Attach your one-pager',
      'Prepare for your approval'
    ],
    draft: (name) =>
      `A personalized introduction to ${name}, written from your fund story and their stated focus, with your one-pager attached and a focused 20-minute call proposed. Approving moves them to Contacted on your map.`
  },
  contacted: {
    label: 'Send the follow-up',
    to: 'soft_circled',
    steps: [
      'Review the conversation so far',
      'Draft the follow-up with the soft-circle ask',
      'Cross-check your raise terms',
      'Prepare for your approval'
    ],
    draft: (name) =>
      `A follow-up to ${name} that moves the conversation to a soft-circle ask — restating the thesis they responded to and proposing an allocation range. Approving moves them to Soft-circle on your map.`
  },
  soft_circled: {
    label: 'Lock the allocation',
    to: 'committed',
    steps: [
      'Confirm the soft-circled amount',
      'Prepare the commitment summary',
      'Stage the subscription pack',
      'Prepare for your approval'
    ],
    draft: (name) =>
      `The commitment summary for ${name} — soft-circled amount confirmed and the subscription pack staged from your formation documents. Approving marks them Committed on your map.`
  }
};

function fitColor(f: number): string {
  return f >= 85 ? 'var(--success)' : f >= 75 ? 'var(--gold-1)' : 'var(--fg-3)';
}

function checkLabel(lp: LpEntry): string {
  if (lp.checkSizeMin != null && lp.checkSizeMax != null)
    return `${compactMoney(lp.checkSizeMin)}–${compactMoney(lp.checkSizeMax)}`;
  const one = lp.checkSizeMax ?? lp.checkSizeMin;
  return one != null ? compactMoney(one) : '—';
}

function lpValue(lp: LpEntry): number {
  if (lp.checkSizeMin != null && lp.checkSizeMax != null)
    return Math.round((lp.checkSizeMin + lp.checkSizeMax) / 2);
  return lp.checkSizeMax ?? lp.checkSizeMin ?? 0;
}

/* ── the LP detail drawer ────────────────────────────────────────────────── */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function LpDrawer({
  lp,
  onClose,
  onRun
}: {
  lp: LpEntry;
  onClose: () => void;
  onRun: (lp: LpEntry) => void;
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

  const move = lp.stage !== 'committed' ? NEXT_MOVE[lp.stage] : null;
  const stageLabel = LP_STAGES.find((s) => s.key === lp.stage)?.label ?? lp.stage;

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
        aria-label={lp.name}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[420px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <Avatar name={lp.name} size={42} tone={lp.stage === 'committed' ? 'gold' : 'azure'} />
          <div className="min-w-0 flex-1">
            <div className="text-[15.5px] font-semibold text-fg-1">{lp.name}</div>
            <div className="text-[11.5px] text-fg-4">
              {lp.capitalTypes.length ? lp.capitalTypes.join(' · ') : 'Capital provider'}
            </div>
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
              <div className="text-[10px] text-fg-5">Check</div>
              <div className="mt-1 text-[14px] font-semibold text-gold-1 [font-feature-settings:'tnum']">
                {checkLabel(lp)}
              </div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Fit</div>
              <div
                className="mt-1 text-[16px] font-semibold [font-feature-settings:'tnum']"
                style={{ color: fitColor(lp.fit) }}
              >
                {lp.fit}
              </div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Stage</div>
              <Badge tone={STAGE_TONE[lp.stage]} className="mt-1.5 px-2 py-0.5 text-[9.5px]">
                {stageLabel}
              </Badge>
            </div>
          </div>

          {(lp.fitRationale || lp.description) && (
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Why they fit
              </div>
              <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
                {lp.fitRationale ?? lp.description}
              </div>
            </div>
          )}

          <div className="flex gap-5 text-[11.5px] text-fg-4">
            {lp.assignedSpecialist && (
              <span>
                <b className="text-fg-2">Specialist</b>
                <br />
                {lp.assignedSpecialist}
              </span>
            )}
            {lp.firstTouchNote && (
              <span className="min-w-0 flex-1">
                <b className="text-fg-2">First touch</b>
                <br />
                <span className="line-clamp-2">{lp.firstTouchNote}</span>
              </span>
            )}
          </div>

          {move ? (
            <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
              <div className="mb-2 flex items-center gap-2">
                <EarnCoin size={24} />
                <span className="text-[12.5px] font-semibold text-gold-1">
                  Earn&apos;s next move
                </span>
              </div>
              <div className="mb-3 text-[12px] leading-relaxed text-fg-2">
                {move.label} — I&apos;ll personalize it from your fund story and their stated focus,
                then queue it for your approval.
              </div>
              <Button
                variant="gold"
                size="sm"
                icon={Sparkles}
                className="w-full"
                onClick={() => onRun(lp)}
              >
                {move.label} with Earn
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
              <CheckCircle2 size={17} aria-hidden />
              Committed · {checkLabel(lp)} on your map
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── the capital map ─────────────────────────────────────────────────────── */

export interface CapitalMapFlowProps {
  /** Flattened LP entries from `getLpPipeline`. */
  lps: LpEntry[];
  /** Raise target in dollars, from the mandate (0 = not set). */
  target: number;
  committedValue: number;
  softCircledValue: number;
}

export function CapitalMapFlow({
  lps: initialLps,
  target,
  committedValue,
  softCircledValue
}: CapitalMapFlowProps) {
  const [lps, setLps] = useState(initialLps);
  const [committed, setCommitted] = useState(committedValue);
  const [soft, setSoft] = useState(softCircledValue);
  const [openId, setOpenId] = useState<string | null>(null);
  const [running, setRunning] = useState<LpEntry | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const stageOrder = LP_STAGES.map((s) => s.key);
  const byStage = (key: LpStageKey) => lps.filter((l) => l.stage === key);
  const pctC = target > 0 ? Math.min(100, Math.round((committed / target) * 100)) : 0;
  const pctS = target > 0 ? Math.min(100 - pctC, Math.round((soft / target) * 100)) : 0;
  const pipelineValue = lps
    .filter((l) => l.stage === 'prospect' || l.stage === 'contacted')
    .reduce((s, l) => s + lpValue(l), 0);

  const openLp = openId ? (lps.find((l) => l.id === openId) ?? null) : null;
  const move = running && running.stage !== 'committed' ? NEXT_MOVE[running.stage] : null;

  function applyAdvance(lp: LpEntry, to: LpStageKey) {
    setLps((prev) => prev.map((l) => (l.id === lp.id ? { ...l, stage: to } : l)));
    const v = lpValue(lp);
    if (to === 'soft_circled') setSoft((s) => s + v);
    if (to === 'committed') {
      setSoft((s) => Math.max(0, s - (lp.stage === 'soft_circled' ? v : 0)));
      setCommitted((c) => c + v);
    }
    const label = LP_STAGES.find((s) => s.key === to)?.label ?? to;
    setToast(`${lp.name} advanced to ${label}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Landmark size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              LP Capital Map
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Fit-scored and ranked by Sloane — every move drafted by Earn, executed on your
              approval.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">{lps.length}</div>
            <div className="text-[10.5px] text-fg-5">LPs mapped</div>
          </div>
        </div>

        {/* raise thermometer */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[12px] text-fg-3">
              <b className="text-fg-1">{compactMoney(committed)}</b> committed{' '}
              <span className="text-fg-5">+ {compactMoney(soft)} soft-circled</span>
            </span>
            <span className="text-[12px] text-fg-4">
              {target > 0 ? (
                <>
                  of <b className="text-gold-1">{compactMoney(target)}</b> target
                </>
              ) : (
                'no target set'
              )}
            </span>
          </div>
          <div
            className="flex h-3 overflow-hidden rounded-full border border-hairline bg-surface-2"
            role="progressbar"
            aria-label="Raise progress"
            aria-valuenow={pctC}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="bg-[linear-gradient(90deg,#1F8A5B,#2fae74)] transition-[width] duration-300"
              style={{ width: `${pctC}%` }}
            />
            <div
              className="bg-[linear-gradient(90deg,#F7C948,#E5A823)] opacity-55 transition-[width] duration-300"
              style={{ width: `${pctS}%` }}
            />
          </div>
          <div className="mt-1.5 text-[11px] text-fg-5">
            {pctC}% closed
            {target > 0 && pipelineValue > 0
              ? ` · ${Math.round((pipelineValue / target) * 100)}% more in pipeline`
              : ''}
          </div>
        </div>
      </Card>

      {/* stage funnel */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {LP_STAGES.map((s) => {
          const items = byStage(s.key);
          const amt = items.reduce((sum, l) => sum + lpValue(l), 0);
          return (
            <div
              key={s.key}
              className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5"
              style={{ borderTopWidth: 2, borderTopColor: STAGE_BAR[s.key] }}
            >
              <div className="truncate text-[10.5px] text-fg-4">{s.label}</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-[18px] font-semibold [font-feature-settings:'tnum']">
                  {items.length}
                </span>
                <span className="text-[10.5px] text-fg-5">· {compactMoney(amt)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* LP cards */}
      {lps.length === 0 ? (
        <Card className="p-8 text-center">
          <Landmark size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No LPs on the map yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Sloane builds the target list from your mandate — LPs land here fit-scored and ranked,
            and every outreach move routes through your approval.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {lps
            .slice()
            .sort(
              (a, b) => stageOrder.indexOf(b.stage) - stageOrder.indexOf(a.stage) || b.fit - a.fit
            )
            .map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setOpenId(l.id)}
                className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-left transition hover:bg-surface-2"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar
                    name={l.name}
                    size={32}
                    tone={l.stage === 'committed' ? 'gold' : 'azure'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{l.name}</div>
                    <div className="truncate text-[10.5px] text-fg-5">
                      {l.capitalTypes.length ? l.capitalTypes.join(' · ') : 'Capital provider'}
                    </div>
                  </div>
                  <Badge tone={STAGE_TONE[l.stage]} className="px-2 py-0.5 text-[9.5px]">
                    {LP_STAGES.find((s) => s.key === l.stage)?.label}
                  </Badge>
                </div>
                <div className="mt-2.5 flex items-center gap-3.5 text-[11px] text-fg-4">
                  <span>
                    Check{' '}
                    <b className="font-mono text-fg-2 [font-feature-settings:'tnum']">
                      {checkLabel(l)}
                    </b>
                  </span>
                  <span>
                    Fit <b style={{ color: fitColor(l.fit) }}>{l.fit}</b>
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
          <b className="text-gold-1">Earn:</b> Tap an LP and I&apos;ll draft the next move — intro,
          follow-up, or the allocation lock. Nothing reaches an LP until you approve.
        </p>
      </Card>

      {openLp && (
        <LpDrawer
          lp={openLp}
          onClose={() => setOpenId(null)}
          onRun={(lp) => {
            setOpenId(null);
            setRunning(lp);
          }}
        />
      )}

      {running && move && (
        <ActionRunner
          title={`${move.label} — ${running.name}`}
          steps={move.steps}
          draftTitle={`${move.label} · ${running.name}`}
          draft={move.draft(running.name)}
          onApprove={() => updateLpStage({ id: running.id, stage: move.to })}
          onClose={() => setRunning(null)}
          onApplied={() => applyAdvance(running, move.to)}
        />
      )}

      {/* trust toast */}
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
