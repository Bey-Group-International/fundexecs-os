'use client';

import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  Building2,
  Check,
  CheckCircle2,
  CircleCheckBig,
  CircleDashed,
  Clock,
  FileSignature,
  FileText,
  Landmark,
  Loader2,
  Lock,
  PenLine,
  ShieldCheck,
  UserPlus,
  X,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button, Card, ProgressBar } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import {
  EX_CLOSE_META,
  EX_CLOSINGS,
  closingProgress,
  closingStepsCopy,
  executeStep,
  isStepDone,
  nextStepIndex,
  stepRunSteps,
  stepStatusMeta,
  type EXStep
} from '@/lib/execute-closings/config';

/* ── icon resolvers ──────────────────────────────────────────────────────── */
const ICONS: Record<string, LucideIcon> = {
  'building-2': Building2,
  landmark: Landmark,
  'user-plus': UserPlus,
  'check-circle-2': CheckCircle2,
  'pen-line': PenLine,
  'circle-dashed': CircleDashed
};
function icon(name: string): LucideIcon {
  return ICONS[name] ?? FileSignature;
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4', className)}
    >
      {children}
    </div>
  );
}

function PanelHeader({
  icon: Ico,
  title,
  eyebrow
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
        <Ico size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div>
        <Eyebrow className="mb-px">{eyebrow}</Eyebrow>
        <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">{title}</div>
      </div>
    </div>
  );
}

/* ── the step drawer (accessible dialog + copiloted execution) ───────────── */

const DRAWER_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function StepDrawer({
  step,
  onExecute,
  onClose
}: {
  step: EXStep;
  onExecute: (stepId: string) => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<'detail' | 'executing'>('detail');
  const [n, setN] = useState(0);
  const steps = stepRunSteps(step);
  const meta = stepStatusMeta(step.status);
  const done = isStepDone(step.status);

  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Full dialog ergonomics: focus into the drawer on open, trap Tab, close on
  // Escape, lock background scroll, restore focus to the opener on close.
  // Mirrors components/dataroom/DataRoomFlow.tsx's VettingGate.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(DRAWER_FOCUSABLE)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE));
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

  // Drive the execution steps, then apply the pure transform upstream.
  useEffect(() => {
    if (phase !== 'executing') return;
    if (reduced) {
      const t = setTimeout(() => {
        onExecute(step.id);
        setPhase('detail');
        setN(0);
      }, 300);
      return () => clearTimeout(t);
    }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= steps.length) {
        clearInterval(timer);
        setTimeout(() => {
          onExecute(step.id);
          setPhase('detail');
          setN(0);
        }, 450);
      }
    }, 600);
    return () => clearInterval(timer);
  }, [phase, reduced, steps.length, step.id, onExecute]);

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
        aria-label={`Execution step — ${step.name}`}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[440px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-[18px]">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
            <FileSignature size={20} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-fg-1">{step.name}</div>
            <div className="text-[11.5px] text-fg-4">
              {step.party} · {step.who}
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

        {phase === 'executing' ? (
          <div className="flex flex-col items-center px-5 py-8 text-center">
            <div className="relative mb-3">
              <span
                aria-hidden
                className="absolute -inset-2.5 rounded-full motion-safe:animate-pulse"
                style={{
                  background: 'radial-gradient(circle, rgba(247,201,72,0.5), transparent 70%)',
                  filter: 'blur(8px)'
                }}
              />
              <EarnCoin size={48} className="relative" />
            </div>
            <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-fg-1">
              {step.action}…
            </h2>
            <p className="mt-1.5 text-[12px] text-fg-3">
              Executing under your approval and sealing it to the Chain of Trust.
            </p>
            <ProgressBar
              value={Math.round((n / steps.length) * 100)}
              gradient="linear-gradient(90deg,#F7C948,#E5A823)"
              height={6}
              ariaLabel="Execution progress"
              className="mt-4 w-full"
            />
            <Card className="mt-3.5 flex w-full flex-col gap-0.5 p-3 text-left">
              {steps.map((s, i) =>
                i <= n ? (
                  <div key={s} className="flex items-center gap-2.5 px-2 py-2">
                    <span
                      className={cn(
                        'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border',
                        i < n
                          ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                          : 'border-hairline bg-surface-2 text-fg-4'
                      )}
                    >
                      {i < n ? (
                        <Check size={12} strokeWidth={2.4} aria-hidden />
                      ) : (
                        <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
                      )}
                    </span>
                    <span className={cn('text-[13px]', i < n ? 'text-fg-2' : 'text-fg-1')}>
                      {s}
                    </span>
                  </div>
                ) : null
              )}
            </Card>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <Badge tone={meta.tone} dot className="self-start">
              {meta.label}
            </Badge>

            <div className="flex items-center gap-2.5 rounded-[11px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-3">
              <Zap size={15} className="flex-none text-gold-1" aria-hidden />
              <span className="text-[12px] text-fg-2">
                <b className="text-gold-1">Why it matters:</b> {step.drives}.
              </span>
            </div>

            <p className="text-[12.5px] leading-relaxed text-fg-3">{step.detail}</p>

            <div className="flex items-center gap-2.5 rounded-[11px] border border-[var(--border-faint)] bg-surface-1 px-3.5 py-3">
              <ShieldCheck size={15} className="flex-none text-success" aria-hidden />
              <span className="text-[11.5px] text-fg-3">
                Every action here is recorded to your 4-layer Chain of Trust — Proof of Truth,
                Concept, Execution and Work.
              </span>
            </div>

            {done ? (
              <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
                <Lock size={17} aria-hidden />
                Executed · recorded to Chain of Trust
              </div>
            ) : step.status === 'ready' ? (
              <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
                <div className="mb-2 flex items-center gap-2.5">
                  <EarnCoin size={24} />
                  <span className="text-[12.5px] font-semibold text-gold-1">Ready to execute</span>
                </div>
                <p className="mb-3 text-[12px] leading-relaxed text-fg-2">
                  This step is ready. {step.action} — nothing executes until you approve, and
                  it&apos;s logged the moment you do.
                </p>
                <Button
                  variant="gold"
                  size="sm"
                  icon={PenLine}
                  className="w-full"
                  onClick={() => setPhase('executing')}
                >
                  {step.action}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-[13px] border border-hairline bg-surface-1 px-4 py-3.5 text-[12.5px] text-fg-4">
                <Clock size={16} className="flex-none" aria-hidden />
                Waiting on the previous step.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ── the closings desk ───────────────────────────────────────────────────── */

export function ExecuteClosingsFlow({ firm }: { firm: string }) {
  const [closeId, setCloseId] = useState<string>(EX_CLOSE_META[0].id);
  const [stepsByClose, setStepsByClose] = useState<Record<string, EXStep[]>>(() => {
    const out: Record<string, EXStep[]> = {};
    for (const meta of EX_CLOSE_META) out[meta.id] = closingStepsCopy(EX_CLOSINGS[meta.id]);
    return out;
  });
  const [openStepId, setOpenStepId] = useState<string | null>(null);

  const closing = EX_CLOSINGS[closeId];
  const steps = stepsByClose[closeId];
  const progress = closingProgress(steps);
  const nextIdx = nextStepIndex(steps);
  const nextStep = nextIdx >= 0 ? steps[nextIdx] : null;

  const execute = (stepId: string) =>
    setStepsByClose((prev) => ({ ...prev, [closeId]: executeStep(prev[closeId], stepId) }));

  const openStep = openStepId ? steps.find((s) => s.id === openStepId) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <CircleCheckBig size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Closings</h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Drive every engagement to a signed close — {firm} approves each step; it&apos;s logged
              forever.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">
              {progress.pct}%
            </div>
            <div className="text-[10.5px] text-fg-5">Executed</div>
          </div>
          <Badge tone="warning" className="ml-1 self-start text-[10px]">
            Illustrative
          </Badge>
        </div>
        <ProgressBar
          value={progress.pct}
          gradient="linear-gradient(90deg,#F7C948,#E5A823)"
          height={6}
          ariaLabel="Closing executed"
          className="mt-3.5"
        />
      </Card>

      <Card className="p-[18px]">
        <PanelHeader
          icon={FileSignature}
          title="Closings"
          eyebrow={`${closing.name} · ${closing.kind} · ${closing.amount}`}
        />

        {/* closing selector */}
        <div className="mb-3.5 flex flex-wrap gap-2">
          {EX_CLOSE_META.map((c) => {
            const on = c.id === closeId;
            const p = closingProgress(stepsByClose[c.id]);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setCloseId(c.id);
                  setOpenStepId(null);
                }}
                className={cn(
                  'flex items-center gap-2.5 rounded-[11px] border px-3.5 py-2.5 text-left transition',
                  on
                    ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]'
                    : 'border-hairline bg-surface-1 hover:bg-surface-2'
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 flex-none items-center justify-center rounded-lg',
                    p.closed
                      ? 'bg-success text-white'
                      : on
                        ? 'bg-[var(--accent)] text-white'
                        : 'border border-hairline bg-surface-2 text-fg-3'
                  )}
                >
                  {createElement(p.closed ? Check : icon(c.icon), {
                    size: 15,
                    'aria-hidden': true
                  })}
                </span>
                <div>
                  <div
                    className={cn('text-[12.5px] font-semibold', on ? 'text-fg-1' : 'text-fg-2')}
                  >
                    {c.label}
                  </div>
                  <div className="text-[10px] text-fg-5">
                    {c.sub} · {p.done}/{p.total}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* close-readiness header */}
        <div className="mb-4 flex flex-wrap gap-3">
          <Card
            className="flex-[2_1_280px] p-4"
            style={{
              borderLeft: `3px solid ${progress.closed ? 'var(--success)' : 'var(--gold-1)'}`
            }}
          >
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
              <Badge tone={progress.closed ? 'success' : 'gold'} dot>
                {progress.closed
                  ? 'Closed & funded'
                  : `${progress.total - progress.done} steps to close`}
              </Badge>
              <span className="text-[11.5px] text-fg-4">{closing.counterparty}</span>
            </div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[11.5px] text-fg-3">
                <b className="text-fg-1">
                  {progress.done}/{progress.total}
                </b>{' '}
                steps executed
              </span>
              <span className="text-[11px] text-fg-4">{closing.amount} consideration</span>
            </div>
            <ProgressBar
              value={progress.pct}
              gradient="linear-gradient(90deg,#1F8A5B,#2fae74)"
              height={7}
              ariaLabel="Steps executed"
            />
          </Card>
          <div className="flex flex-col justify-center gap-2">
            <Button
              variant={progress.closed ? 'secondary' : 'gold'}
              size="sm"
              icon={progress.closed ? CheckCircle2 : PenLine}
              disabled={progress.closed || !nextStep}
              onClick={() => nextStep && setOpenStepId(nextStep.id)}
            >
              {progress.closed ? 'Closed' : nextStep ? nextStep.action : '—'}
            </Button>
            <Button variant="ghost" size="sm" icon={FileText}>
              Closing binder
            </Button>
          </div>
        </div>

        {/* execution timeline */}
        <div className="flex flex-col">
          {steps.map((s, i) => {
            const meta = stepStatusMeta(s.status);
            const stepDone = isStepDone(s.status);
            const isNext = i === nextIdx;
            return (
              <div key={s.id} className="flex items-stretch gap-3.5">
                {/* rail */}
                <div className="flex w-7 flex-none flex-col items-center">
                  <div
                    className={cn(
                      'flex h-7 w-7 flex-none items-center justify-center rounded-full border text-[11px] font-bold',
                      stepDone
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : isNext
                          ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
                          : 'border-hairline bg-surface-2 text-fg-5'
                    )}
                  >
                    {stepDone ? <Check size={14} aria-hidden /> : i + 1}
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className="w-0.5 flex-1"
                      style={{
                        minHeight: 16,
                        background: stepDone ? 'var(--success-line)' : 'var(--border)'
                      }}
                    />
                  )}
                </div>
                {/* card */}
                <button
                  type="button"
                  onClick={() => setOpenStepId(s.id)}
                  className={cn(
                    'mb-2.5 flex flex-1 items-center gap-3 rounded-[12px] border px-3.5 py-3 text-left transition',
                    isNext ? 'border-[var(--gold-line)]' : 'border-hairline',
                    stepDone ? 'bg-surface-1 opacity-[0.78]' : 'bg-surface-1 hover:bg-surface-2'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-fg-1">{s.name}</span>
                      <Badge tone={meta.tone} className="flex-none text-[9px]">
                        {meta.label}
                      </Badge>
                    </div>
                    <div className={cn('mt-0.5 text-[11px]', isNext ? 'text-gold-1' : 'text-fg-5')}>
                      {s.drives} · {s.who}
                    </div>
                  </div>
                  {stepDone && <Lock size={14} className="flex-none text-success" aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>

        {progress.closed && (
          <Card
            className="mt-1 p-[18px] text-center"
            style={{ background: 'var(--success-soft)', borderColor: 'var(--success-line)' }}
          >
            <CircleCheckBig size={28} className="mx-auto text-success" aria-hidden />
            <div className="mt-2 text-[16px] font-semibold text-fg-1">
              {closing.name} is closed.
            </div>
            <p className="mt-1 text-[12.5px] text-fg-3">
              {closing.amount} funded · signed, wired and logged to your Chain of Trust. {firm} now
              owns it.
            </p>
          </Card>
        )}
      </Card>

      {openStep && (
        <StepDrawer step={openStep} onExecute={execute} onClose={() => setOpenStepId(null)} />
      )}
    </div>
  );
}
