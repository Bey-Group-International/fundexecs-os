'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  CheckCircle2,
  DollarSign,
  Landmark,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Field } from '@/components/ui/Field';
import { adoptLp } from '@/lib/actions/lp-pipeline';
import { advanceLpStage } from '@/lib/pipeline/actions';
import { compactMoney } from '@/lib/format';
import { LP_STAGES, lpValue, type LpEntry, type LpStageKey } from '@/lib/pipeline/lp-stages';

/* ── stage vocabulary (the prototype's LP_STAGE_TONE over canonical keys) ── */

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

/** The prototype's LP_NEXT — Earn's next move per stage. */
const NEXT_MOVE: Record<Exclude<LpStageKey, 'committed'>, { label: string; to: LpStageKey }> = {
  prospect: { label: 'Draft intro', to: 'contacted' },
  contacted: { label: 'Send follow-up', to: 'soft_circled' },
  soft_circled: { label: 'Lock allocation', to: 'committed' }
};

/** The prototype's runLp choreography, per move. */
function moveSteps(act: string): string[] {
  return [
    'Pull engagement + fit signals',
    `Draft the ${act.toLowerCase()}`,
    'Attach your one-pager + track record',
    'Prepare for your approval'
  ];
}

function moveDraft(lp: LpEntry, act: string): string {
  const fitPart = lp.fit != null ? `, fit ${lp.fit}` : '';
  return `Earn drafted a personalized ${act.toLowerCase()} for ${lp.name} (${lpType(lp)}${fitPart}). Approve to send and advance them to the next stage — nothing leaves FundExecs OS until you confirm.`;
}

function fitColor(f: number): string {
  return f >= 85 ? 'var(--success)' : f >= 75 ? 'var(--gold-1)' : 'var(--fg-3)';
}

function lpType(lp: LpEntry): string {
  return lp.capitalTypes.length ? lp.capitalTypes.join(' · ') : 'Capital provider';
}

function checkLabel(lp: LpEntry): string {
  if (lp.checkSizeMin != null && lp.checkSizeMax != null && lp.checkSizeMin !== lp.checkSizeMax)
    return `${compactMoney(lp.checkSizeMin)}–${compactMoney(lp.checkSizeMax)}`;
  const one = lp.checkSizeMax ?? lp.checkSizeMin;
  return one != null ? compactMoney(one) : '—';
}

function lpVal(lp: LpEntry): number {
  return lpValue(lp.checkSizeMin, lp.checkSizeMax);
}

/* ── modal focus management (drawer + dialog) ────────────────────────────── */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap focus inside a modal panel: focus the first focusable on mount, cycle
 * Tab/Shift+Tab, close on Escape, lock body scroll, and restore focus to the
 * opener on unmount.
 */
function useModalFocus(onClose: () => void) {
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

  return panelRef;
}

/* ── the LP detail drawer ────────────────────────────────────────────────── */

function LpDrawer({
  lp,
  onClose,
  onRun
}: {
  lp: LpEntry;
  onClose: () => void;
  onRun: (lp: LpEntry) => void;
}) {
  const panelRef = useModalFocus(onClose);

  const move = lp.stage !== 'committed' ? NEXT_MOVE[lp.stage] : null;
  const stageLabel = LP_STAGES.find((s) => s.key === lp.stage)?.label ?? lp.stage;
  const rationale = lp.fitRationale ?? lp.description;
  const metaPairs = [
    ['Source', lp.source],
    ['Last touch', lp.lastTouch],
    ['Specialist', lp.assignedSpecialist],
    ['First touch', lp.firstTouchNote]
  ].filter((pair): pair is [string, string] => Boolean(pair[1]));

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
              {lpType(lp)}
              {lp.warmth ? ` · ${lp.warmth} lead` : ''}
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
              <div className="text-[10px] text-fg-5">Fit score</div>
              <div
                className="mt-1 text-[16px] font-semibold [font-feature-settings:'tnum']"
                style={{ color: lp.fit != null ? fitColor(lp.fit) : 'var(--fg-5)' }}
              >
                {lp.fit ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Stage</div>
              <Badge tone={STAGE_TONE[lp.stage]} className="mt-1.5 px-2 py-0.5 text-[9.5px]">
                {stageLabel}
              </Badge>
            </div>
          </div>

          {(rationale || lp.fit != null) && (
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Why they fit
              </div>
              <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
                {rationale ? rationale.replace(/\.?\s*$/, '') : null}
                {rationale && lp.fit != null ? '. ' : null}
                {lp.fit != null
                  ? `Sloane scored this a ${lp.fit} on thesis alignment, check size and warmth.`
                  : null}
              </div>
            </div>
          )}

          {metaPairs.length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-2.5 text-[11.5px] text-fg-4">
              {metaPairs.map(([label, value]) => (
                <span key={label} className="min-w-0 max-w-full">
                  <b className="text-fg-2">{label}</b>
                  <br />
                  <span className="line-clamp-2">{value}</span>
                </span>
              ))}
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
              Committed · {checkLabel(lp)} closed
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── "Build more targets" — a real target, logged through the approve loop ── */

function AddTargetDialog({
  noun,
  onClose,
  onSubmit
}: {
  noun: string;
  onClose: () => void;
  onSubmit: (name: string, type: string | null, check: number | null) => void;
}) {
  const panelRef = useModalFocus(onClose);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [checkRaw, setCheckRaw] = useState('');

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Keep digits and the decimal point ("$10,000,000.00" → 10000000), then
    // round to whole dollars — check sizes are stored as integers.
    const parsed = Number.parseFloat(checkRaw.replace(/[^0-9.]/g, ''));
    onSubmit(
      trimmed,
      type.trim() || null,
      Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
    );
  }

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
        aria-label="Add a target"
        className="fixed left-1/2 top-1/2 z-[61] w-[420px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border-strong)] bg-bg-2 p-5 shadow-[var(--shadow-lg)]"
      >
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
            <Landmark size={16} aria-hidden />
          </span>
          <h2 className="text-[14.5px] font-semibold text-fg-1">Add a target</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1"
          >
            <X size={17} aria-hidden />
          </button>
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-fg-4">
          Name the {noun === 'LP' ? 'investor' : noun} and Earn logs them on your map — Sloane
          scores the fit against your mandate, and every outreach move routes through your approval.
        </p>
        <div className="flex flex-col gap-3">
          <Field
            label="Name"
            value={name}
            onChange={setName}
            icon={Building2}
            placeholder="e.g. Granite Endowment"
            required
          />
          <Field
            label="Type"
            value={type}
            onChange={setType}
            icon={Landmark}
            placeholder="e.g. Family office"
            hint="Optional."
          />
          <Field
            label="Check size"
            value={checkRaw}
            onChange={setCheckRaw}
            icon={DollarSign}
            placeholder="10000000"
            hint="Optional — in dollars."
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gold" size="sm" icon={Sparkles} disabled={!name.trim()} onClick={submit}>
            Add with Earn
          </Button>
        </div>
      </div>
    </>
  );
}

/* ── the capital map ─────────────────────────────────────────────────────── */

export interface CapitalMapFlowProps {
  /** Flattened LP entries from `getLpPipeline`. */
  lps: LpEntry[];
  /** Raise target in dollars, from the org's real raise target (0 = not set). */
  target: number;
  committedValue: number;
  softCircledValue: number;
  /** The persona's tab title (`SRC_TITLE`) — "LP Capital Map" for funds. */
  title: string;
  /** The persona's noun (`SRC_NOUN`) — "LP" for funds. */
  noun: string;
}

export function CapitalMapFlow({
  lps: initialLps,
  target,
  committedValue,
  softCircledValue,
  title,
  noun
}: CapitalMapFlowProps) {
  const router = useRouter();
  const [lps, setLps] = useState(initialLps);
  const [committed, setCommitted] = useState(committedValue);
  const [soft, setSoft] = useState(softCircledValue);
  const [openId, setOpenId] = useState<string | null>(null);
  const [running, setRunning] = useState<LpEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [sourcing, setSourcing] = useState<{
    name: string;
    type: string | null;
    check: number | null;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Server refreshes (after a create) re-seed the board and the roll-ups.
  const [seededFrom, setSeededFrom] = useState(initialLps);
  if (seededFrom !== initialLps) {
    setSeededFrom(initialLps);
    setLps(initialLps);
    setCommitted(committedValue);
    setSoft(softCircledValue);
  }

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
    .reduce((s, l) => s + lpVal(l), 0);

  const openLp = openId ? (lps.find((l) => l.id === openId) ?? null) : null;
  const move = running && running.stage !== 'committed' ? NEXT_MOVE[running.stage] : null;
  const article = noun === 'LP' ? 'an LP' : `a ${noun}`;

  function applyAdvance(lp: LpEntry, to: LpStageKey) {
    setLps((prev) => prev.map((l) => (l.id === lp.id ? { ...l, stage: to } : l)));
    const v = lpVal(lp);
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
      {/* the prototype's LpCapitalMap panel — thermometer, funnel and cards in one frame */}
      <Card className="p-[18px]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <Landmark size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <div className="mb-px text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Fit-scored &amp; ranked by Sloane · tap {article} to open
              </div>
              <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">{title}</h2>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={Sparkles} onClick={() => setAdding(true)}>
            Build more targets
          </Button>
        </div>

        {/* raise thermometer */}
        <div className="mb-4">
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

        {/* stage funnel */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {LP_STAGES.map((s) => {
            const items = byStage(s.key);
            const amt = items.reduce((sum, l) => sum + lpVal(l), 0);
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
          <div className="px-4 py-8 text-center">
            <Landmark size={22} className="mx-auto text-fg-4" aria-hidden />
            <h3 className="mt-3 text-[15px] font-semibold text-fg-1">No {noun}s on the map yet</h3>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              Sloane builds the target list from your mandate — {noun}s land here fit-scored and
              ranked, and every outreach move routes through your approval.
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={Sparkles}
              className="mt-4"
              onClick={() => setAdding(true)}
            >
              Add your first target
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {lps
              .slice()
              .sort(
                (a, b) =>
                  stageOrder.indexOf(b.stage) - stageOrder.indexOf(a.stage) ||
                  (b.fit ?? -1) - (a.fit ?? -1) ||
                  lpVal(b) - lpVal(a)
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
                      <div className="truncate text-[10.5px] text-fg-5">{lpType(l)}</div>
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
                    {l.fit != null && (
                      <span>
                        Fit <b style={{ color: fitColor(l.fit) }}>{l.fit}</b>
                      </span>
                    )}
                    {l.warmth && <span>{l.warmth}</span>}
                  </div>
                </button>
              ))}
          </div>
        )}
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

      {adding && (
        <AddTargetDialog
          noun={noun}
          onClose={() => setAdding(false)}
          onSubmit={(name, type, check) => {
            setAdding(false);
            setSourcing({ name, type, check });
          }}
        />
      )}

      {sourcing && (
        <ActionRunner
          title={`Add ${sourcing.name}`}
          steps={[
            'Log them on your capital map',
            'Score the fit against your mandate',
            'Stage the first-touch note',
            'Prepare for your approval'
          ]}
          draftTitle={`New target · ${sourcing.name}`}
          draft={`${sourcing.name} joins your map${
            sourcing.check ? ` at ${compactMoney(sourcing.check)}` : ''
          }${
            sourcing.type ? ` (${sourcing.type})` : ''
          } — Sloane scores the fit on arrival and Earn stages the intro. Approve to log them; every move from here routes through you.`}
          onApprove={async () => {
            const res = await adoptLp({
              name: sourcing.name,
              capitalTypes: sourcing.type ? [sourcing.type] : [],
              checkSizeMin: sourcing.check,
              checkSizeMax: sourcing.check
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setSourcing(null)}
          onApplied={() => {
            setToast(`${sourcing.name} added to your map`);
            router.refresh();
          }}
        />
      )}

      {running && move && (
        <ActionRunner
          title={`${move.label} — ${running.name}`}
          steps={moveSteps(move.label)}
          draftTitle={`${move.label} — ${running.name}`}
          draft={moveDraft(running, move.label)}
          onApprove={() => advanceLpStage({ id: running.id })}
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
