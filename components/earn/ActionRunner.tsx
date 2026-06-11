'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  Check,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { cn } from '@/lib/utils';

/**
 * The approve-loop modal — the prototype's ActionRunner made real. Earn
 * "works" through the run steps, presents the draft, and nothing executes
 * until the operator approves; `onApprove` performs the actual server write
 * (with pending + error states), and only a successful write closes the loop.
 * Shared by the hub interiors so the loop reads identically everywhere.
 */
export interface ActionRunnerProps {
  title: string;
  /** The visible execution steps Earn walks through. */
  steps: string[];
  draftTitle: string;
  draft: string;
  approveLabel?: string;
  /** The real mutation. Resolve `{ ok: false }` to surface the error inline. */
  onApprove: () => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  /** Called after a successful approve (for optimistic UI + toasts). */
  onApplied: () => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ActionRunner({
  title,
  steps,
  draftTitle,
  draft,
  approveLabel = 'Approve & execute',
  onApprove,
  onClose,
  onApplied
}: ActionRunnerProps) {
  const reduced = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<'run' | 'draft' | 'applied'>('run');
  const [n, setN] = useState(0);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Dialog ergonomics: focus in, trap Tab, Escape closes, restore on close.
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

  // Earn "works" through the steps, then presents the draft.
  useEffect(() => {
    if (phase !== 'run') return;
    if (reduced) {
      const t = setTimeout(() => setPhase('draft'), 300);
      return () => clearTimeout(t);
    }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= steps.length) {
        clearInterval(timer);
        setTimeout(() => setPhase('draft'), 420);
      }
    }, 620);
    return () => clearInterval(timer);
  }, [phase, reduced, steps.length]);

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const res = await onApprove();
      if (res.ok) {
        setPhase('applied');
        setTimeout(() => {
          onApplied();
          onClose();
        }, 900);
      } else {
        setError(res.error ?? 'Could not execute — try again.');
      }
    } catch {
      setError('Could not execute — check your connection and try again.');
    } finally {
      setApproving(false);
    }
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
        aria-label={title}
        className="fixed left-1/2 top-1/2 z-[61] max-h-[88vh] w-[540px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] border border-[var(--border-strong)] bg-bg-2 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline bg-[linear-gradient(100deg,rgba(247,201,72,0.10),transparent_60%)] px-5 py-4">
          <EarnCoin size={40} online className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-semibold text-fg-1">{title}</div>
            <div
              className={cn(
                'mt-0.5 flex items-center gap-1.5 text-[11.5px]',
                phase === 'applied' ? 'text-success' : 'text-gold-1'
              )}
            >
              {phase === 'applied' ? (
                <CheckCircle2 size={12} aria-hidden />
              ) : (
                <Sparkles size={12} aria-hidden />
              )}
              {phase === 'run'
                ? 'Earn is working…'
                : phase === 'draft'
                  ? 'Draft ready for your review'
                  : 'Applied & logged'}
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

        <div className="p-5">
          <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Execution
          </div>
          <div className="mb-4 flex flex-col gap-0.5">
            {steps.map((s, i) => {
              const isDone = i < n || phase !== 'run';
              const now = i === n && phase === 'run';
              return (
                <div key={s} className="flex items-center gap-2.5 py-2">
                  <span
                    className={cn(
                      'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border',
                      isDone
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : 'border-hairline bg-surface-2 text-fg-4'
                    )}
                  >
                    {isDone ? (
                      <Check size={12} strokeWidth={2.4} aria-hidden />
                    ) : now ? (
                      <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
                    ) : (
                      <span className="h-[5px] w-[5px] rounded-full bg-fg-5" aria-hidden />
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-[13px]',
                      isDone ? 'text-fg-2' : now ? 'text-fg-1' : 'text-fg-5'
                    )}
                  >
                    {s}
                  </span>
                </div>
              );
            })}
          </div>

          {phase !== 'run' && (
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Earn&apos;s draft
              </div>
              <div className="rounded-[14px] border border-[var(--azure-line)] bg-[var(--azure-soft)] p-4">
                <div className="mb-1.5 text-[13px] font-semibold text-fg-1">{draftTitle}</div>
                <div className="text-[12.5px] leading-relaxed text-fg-2">{draft}</div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
              <TriangleAlert size={15} aria-hidden />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-hairline px-5 py-3.5">
          {phase === 'applied' ? (
            <div className="flex items-center gap-2 text-[13px] font-semibold text-success">
              <CheckCircle2 size={16} aria-hidden />
              Done — applied to your record
            </div>
          ) : (
            <>
              <div className="flex flex-1 items-center gap-1.5 text-[11.5px] text-fg-5">
                <ShieldCheck size={13} aria-hidden />
                Nothing executes until you approve.
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Not now
              </Button>
              <Button
                icon={approving ? Loader2 : Check}
                disabled={phase === 'run' || approving}
                onClick={() => void approve()}
              >
                {approving ? 'Executing…' : approveLabel}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
