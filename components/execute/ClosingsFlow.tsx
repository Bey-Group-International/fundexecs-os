'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  CircleCheckBig,
  FileSignature,
  FileText,
  Landmark,
  PenLine,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { executeClosingStep, openClosing } from '@/lib/closings/actions';
import {
  CLOSING_KIND_LABEL,
  STEP_DISPLAY,
  STEP_SEQUENCE,
  isClosingKind,
  isStepDone,
  nextExecutableSeq,
  stepDisplayStatus,
  type ClosingKind,
  type ClosingStepSpec
} from '@/lib/closings/sequence';
import { compactMoney } from '@/lib/format';
import type { ClosingCandidate, ClosingStepView, ClosingView } from '@/lib/queries/closings';
import { cn } from '@/lib/utils';

type RunnerState =
  | { type: 'open'; candidate: ClosingCandidate }
  | { type: 'step'; closing: ClosingView; step: ClosingStepView; spec?: ClosingStepSpec };

function specFor(closing: ClosingView, seq: number): ClosingStepSpec | undefined {
  return isClosingKind(closing.kind)
    ? STEP_SEQUENCE[closing.kind as ClosingKind][seq - 1]
    : undefined;
}

/* ── modal focus management (mirrors the house drawer pattern) ───────────── */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

/* ── the step drawer ─────────────────────────────────────────────────────── */

function StepDrawer({
  closing,
  step,
  isNext,
  onClose,
  onExecute
}: {
  closing: ClosingView;
  step: ClosingStepView;
  isNext: boolean;
  onClose: () => void;
  onExecute: (step: ClosingStepView) => void;
}) {
  const panelRef = useModalFocus(onClose);
  const spec = specFor(closing, step.seq);
  const display = stepDisplayStatus(step.status, isNext, spec?.wire);
  const chip = STEP_DISPLAY[display];

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
        aria-label={step.name}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[440px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
            <FileSignature size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15.5px] font-semibold text-fg-1">{step.name}</div>
            <div className="text-[11.5px] text-fg-4">
              Step {step.seq} of {closing.progress.total}
              {spec ? ` · ${spec.who}` : ''}
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
              <div className="text-[10px] text-fg-5">Status</div>
              <Badge tone={chip.tone} className="mt-1.5 px-2 py-0.5 text-[9.5px]">
                {chip.label}
              </Badge>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Party</div>
              <div className="mt-1 text-[13px] font-semibold text-fg-2">{spec?.party ?? '—'}</div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Prepared by</div>
              <div className="mt-1 truncate text-[12px] font-semibold text-fg-2">
                {spec?.who ?? '—'}
              </div>
            </div>
          </div>

          {spec ? (
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                What this step does
              </div>
              <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
                {spec.detail}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-fg-4">
                <CircleCheckBig size={13} className="text-gold-1" aria-hidden />
                {spec.drives}
              </div>
            </div>
          ) : null}

          {isStepDone(step.status) ? (
            <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
              <CheckCircle2 size={17} aria-hidden />
              Executed · logged to Chain of Trust
            </div>
          ) : isNext ? (
            <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
              <div className="mb-2 flex items-center gap-2">
                <EarnCoin size={24} />
                <span className="text-[12.5px] font-semibold text-gold-1">Ready to execute</span>
              </div>
              <div className="mb-3 text-[12px] leading-relaxed text-fg-2">
                This step is ready. {spec?.action ?? 'Execute'} — nothing executes until you
                approve, and it&apos;s logged the moment you do.
              </div>
              <Button
                variant="gold"
                size="sm"
                icon={PenLine}
                className="w-full"
                onClick={() => onExecute(step)}
              >
                {spec?.action ?? 'Execute'}
              </Button>
            </div>
          ) : (
            <div className="rounded-[13px] border border-hairline bg-surface-1 px-4 py-3.5 text-[12px] leading-relaxed text-fg-4">
              Executes after step {step.seq - 1} — the sequence is strict, so nothing gets skipped.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── the closings center ─────────────────────────────────────────────────── */

export function ClosingsFlow({
  closings,
  candidates,
  firm
}: {
  closings: ClosingView[];
  candidates: ClosingCandidate[];
  firm: string | null;
}) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    closings.find((c) => c.status === 'open')?.id ?? closings[0]?.id ?? null
  );
  const [openStepId, setOpenStepId] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const selected = closings.find((c) => c.id === selectedId) ?? closings[0] ?? null;
  const gate = selected ? nextExecutableSeq(selected.steps) : null;
  const nextStep = selected && gate != null ? selected.steps.find((s) => s.seq === gate) : null;
  const nextSpec = selected && nextStep ? specFor(selected, nextStep.seq) : undefined;
  const closed = selected ? selected.progress.complete : false;
  const kindLabel =
    selected && isClosingKind(selected.kind) ? CLOSING_KIND_LABEL[selected.kind] : selected?.kind;
  const openStep =
    selected && openStepId ? (selected.steps.find((s) => s.id === openStepId) ?? null) : null;

  function executeStep(closing: ClosingView, step: ClosingStepView) {
    setOpenStepId(null);
    setRunner({ type: 'step', closing, step, spec: specFor(closing, step.seq) });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* the prototype's Closings panel — switcher, progress, ladder in one frame */}
      {selected ? (
        <Card className="p-[18px]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                <FileSignature size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <div>
                <div className="mb-px text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                  {selected.counterparty ?? kindLabel} · {kindLabel}
                  {selected.amount ? ` · ${compactMoney(selected.amount)}` : ''}
                </div>
                <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                  Closings
                </h2>
              </div>
            </div>
          </div>

          {/* closing switcher — one chip per real room */}
          {closings.length > 1 ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {closings.map((c) => {
                const on = c.id === selected.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(c.id);
                      setOpenStepId(null);
                    }}
                    className={cn(
                      'flex items-center gap-2.5 rounded-[11px] border px-3 py-2 text-left transition',
                      on
                        ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]'
                        : 'border-hairline bg-surface-1 hover:bg-surface-2'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 flex-none items-center justify-center rounded-lg',
                        on
                          ? 'bg-[var(--accent)] text-white'
                          : 'border border-hairline bg-surface-2 text-fg-3'
                      )}
                    >
                      {c.kind === 'deal' ? (
                        <Building2 size={15} aria-hidden />
                      ) : (
                        <Landmark size={15} aria-hidden />
                      )}
                    </span>
                    <span>
                      <span
                        className={cn(
                          'block text-[12.5px] font-semibold',
                          on ? 'text-fg-1' : 'text-fg-2'
                        )}
                      >
                        {c.counterparty ??
                          (isClosingKind(c.kind) ? CLOSING_KIND_LABEL[c.kind] : c.kind)}
                      </span>
                      <span className="block text-[10px] text-fg-5">
                        {c.progress.done}/{c.progress.total} executed
                        {c.amount ? ` · ${compactMoney(c.amount)}` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* progress header */}
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="min-w-[280px] flex-[2] rounded-xl border border-hairline bg-surface-1 px-4 py-3.5">
              <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-bold',
                    closed
                      ? 'border border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                      : 'border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
                  )}
                >
                  {closed ? (
                    <CircleCheckBig size={14} aria-hidden />
                  ) : (
                    <PenLine size={14} aria-hidden />
                  )}
                  {closed
                    ? 'Closed & funded'
                    : `${selected.progress.total - selected.progress.done} steps to close`}
                </span>
                <span className="text-[11.5px] text-fg-3">
                  <b className="text-fg-1">
                    {selected.progress.done}/{selected.progress.total}
                  </b>{' '}
                  steps executed
                </span>
              </div>
              <div
                className="w-full overflow-hidden rounded-full bg-surface-2"
                style={{ height: 7 }}
                role="progressbar"
                aria-label="Closing progress"
                aria-valuenow={selected.progress.pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${selected.progress.pct}%`,
                    background: 'var(--success)'
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col justify-center gap-2">
              <Button
                variant={closed ? 'secondary' : 'gold'}
                size="sm"
                icon={closed ? CheckCircle2 : PenLine}
                disabled={closed || !nextStep}
                onClick={() => nextStep && executeStep(selected, nextStep)}
              >
                {closed ? 'Closed' : (nextSpec?.action ?? 'Execute next')}
              </Button>
              <Link href="/build/data-room">
                <Button variant="ghost" size="sm" icon={FileText} className="w-full">
                  Closing binder
                </Button>
              </Link>
            </div>
          </div>

          {/* the step ladder */}
          <div className="flex flex-col">
            {selected.steps.map((s, i) => {
              const done = isStepDone(s.status);
              const isNext = gate === s.seq && selected.status === 'open';
              const spec = specFor(selected, s.seq);
              const display = stepDisplayStatus(s.status, isNext, spec?.wire);
              const chip = STEP_DISPLAY[display];
              return (
                <div key={s.id} className="flex gap-3">
                  {/* timeline spine */}
                  <div className="flex w-7 flex-none flex-col items-center">
                    <span
                      className={cn(
                        'flex h-7 w-7 flex-none items-center justify-center rounded-full border text-[10px] font-bold',
                        done
                          ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                          : isNext
                            ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
                            : 'border-hairline bg-surface-2 text-fg-5'
                      )}
                    >
                      {done ? <Check size={13} strokeWidth={2.4} aria-hidden /> : s.seq}
                    </span>
                    {i < selected.steps.length - 1 ? (
                      <span
                        className={cn(
                          'w-[2px] flex-1',
                          done ? 'bg-[var(--success-line)]' : 'bg-[var(--border-faint)]'
                        )}
                        style={{ minHeight: 14 }}
                        aria-hidden
                      />
                    ) : null}
                  </div>
                  {/* step row */}
                  <button
                    type="button"
                    onClick={() => setOpenStepId(s.id)}
                    className={cn(
                      'mb-2 flex min-w-0 flex-1 items-center gap-3 rounded-[11px] border px-3.5 py-2.5 text-left transition hover:bg-surface-2',
                      isNext
                        ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                        : 'border-[var(--border-faint)] bg-surface-1'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'truncate text-[12.5px]',
                            done ? 'text-fg-3' : isNext ? 'font-semibold text-fg-1' : 'text-fg-4'
                          )}
                        >
                          {s.name}
                        </span>
                        <Badge tone={chip.tone} className="flex-none px-2 py-0.5 text-[9px]">
                          {chip.label}
                        </Badge>
                      </span>
                      {spec ? (
                        <span className="mt-0.5 block truncate text-[10.5px] text-fg-5">
                          {spec.who} · {spec.party} · {spec.drives}
                        </span>
                      ) : null}
                    </span>
                    {isNext && spec ? (
                      <Button
                        variant="gold"
                        size="sm"
                        icon={Sparkles}
                        className="flex-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          executeStep(selected, s);
                        }}
                      >
                        {spec.action}
                      </Button>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>

          {/* the closed celebration */}
          {closed ? (
            <div className="mt-3 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5">
              <div className="flex items-center gap-2.5 text-[13.5px] font-semibold text-success">
                <CircleCheckBig size={18} aria-hidden />
                Closed &amp; funded
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">
                {selected.amount ? `${compactMoney(selected.amount)} funded · ` : ''}signed, wired
                and logged to your Chain of Trust.
                {selected.kind === 'deal' && firm ? ` ${firm} now owns it.` : ''}
              </p>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <FileSignature size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">Nothing at close yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Drive a deal to Committed or lock an LP allocation on your Capital Map — it lands here
            as a signature room, step-gated to a funded close.
          </p>
        </Card>
      )}

      {/* open a closing */}
      {candidates.length > 0 && (
        <Card className="p-[18px]">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <Sparkles size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Ready to close
              </div>
              <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                Open a signature room
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {candidates.map((c) => (
              <div
                key={`${c.kind}:${c.id}`}
                className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                  {c.kind === 'deal' ? (
                    <Building2 size={16} aria-hidden />
                  ) : (
                    <Landmark size={16} aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-fg-1">{c.name}</div>
                  <div className="text-[10.5px] text-fg-5">
                    {CLOSING_KIND_LABEL[c.kind]}
                    {c.amount ? ` · ${compactMoney(c.amount)}` : ''}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Sparkles}
                  onClick={() => setRunner({ type: 'open', candidate: c })}
                >
                  Open closing
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Earn's standing note */}
      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Closings fail in the gaps between steps. I hold the
          sequence — each step executes in order, nothing is skipped, and the close is logged the
          moment it lands.
        </p>
      </Card>

      {selected && openStep && (
        <StepDrawer
          closing={selected}
          step={openStep}
          isNext={gate === openStep.seq && selected.status === 'open'}
          onClose={() => setOpenStepId(null)}
          onExecute={(s) => executeStep(selected, s)}
        />
      )}

      {runner?.type === 'open' && (
        <ActionRunner
          title={`Open the closing — ${runner.candidate.name}`}
          steps={[
            'Pull the committed terms',
            'Stage the signature room',
            'Sequence the execution steps',
            'Prepare for your approval'
          ]}
          draftTitle={`Signature room · ${runner.candidate.name}`}
          draft={`A ${CLOSING_KIND_LABEL[runner.candidate.kind].toLowerCase()} room for ${runner.candidate.name}${runner.candidate.amount ? ` (${compactMoney(runner.candidate.amount)})` : ''} with the ${STEP_SEQUENCE[runner.candidate.kind].length}-step sequence staged — ${STEP_SEQUENCE[
            runner.candidate.kind
          ]
            .map((s) => s.name.toLowerCase())
            .join(' → ')}. Approving opens the room; each step then executes on your approval.`}
          approveLabel="Approve & open"
          onApprove={async () => {
            const res = await openClosing({
              kind: runner.candidate.kind,
              counterparty: runner.candidate.name,
              amount: runner.candidate.amount
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`Signature room opened — ${runner.candidate.name}`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'step' && (
        <ActionRunner
          title={`${runner.spec?.action ?? runner.step.name} — ${runner.closing.counterparty ?? 'closing'}`}
          steps={[
            'Pull the execution package',
            runner.spec?.action ?? runner.step.name,
            'Capture signatures / confirmations',
            'Log to Chain of Trust'
          ]}
          draftTitle={runner.step.name}
          draft={`${runner.spec?.who ?? 'Earn'} prepared this step. ${runner.spec?.detail ?? ''} Approve to execute — every action is recorded to your 4-layer proof.`}
          approveLabel="Approve & execute"
          onApprove={async () => {
            const res = await executeClosingStep({
              closingId: runner.closing.id,
              seq: runner.step.seq
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(
              runner.step.seq === runner.closing.progress.total
                ? `${runner.closing.counterparty ?? 'Closing'} — closed & recorded`
                : `${runner.step.name} — executed`
            );
            router.refresh();
          }}
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
