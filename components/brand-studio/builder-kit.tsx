'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowLeft, Check, Hand, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn } from '@/lib/utils';

/**
 * Shared chrome for the studio's copiloted builders — the edit → building →
 * done choreography every builder walks (the prototype repeats this inline;
 * here it lives once).
 */

export type BuildPhase = 'edit' | 'building' | 'done';

/** Phase state + the timed building sequence (reduced-motion safe). */
export function useBuildSequence(stepCount: number, startDone: boolean) {
  const reduced = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<BuildPhase>(startDone ? 'done' : 'edit');
  const [n, setN] = useState(0);

  useEffect(() => {
    if (phase !== 'building') return;
    if (reduced) {
      const t = setTimeout(() => setPhase('done'), 300);
      return () => clearTimeout(t);
    }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= stepCount) {
        clearInterval(timer);
        setTimeout(() => setPhase('done'), 420);
      }
    }, 570);
    return () => clearInterval(timer);
  }, [phase, reduced, stepCount]);

  const begin = () => {
    setN(0);
    setPhase('building');
  };
  const backToEdit = () => {
    setPhase('edit');
    setN(0);
  };
  return { phase, n, begin, backToEdit };
}

/** The gold-glow "Earn is producing…" screen with the step checklist. */
export function BuildingScreen({
  heading,
  steps,
  n
}: {
  heading: string;
  steps: string[];
  n: number;
}) {
  const pct = Math.round((n / steps.length) * 100);
  return (
    <div className="mx-auto flex w-full max-w-[540px] flex-col items-center py-6">
      <div className="mb-4 flex flex-col items-center text-center">
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
        <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">{heading}</h2>
      </div>
      <ProgressBar value={pct} height={6} label="Production progress" className="w-full" />
      <Card className="mt-3.5 flex w-full flex-col gap-0.5 p-3">
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
              <span className={cn('text-[13px]', i < n ? 'text-fg-2' : 'text-fg-1')}>{s}</span>
            </div>
          ) : null
        )}
      </Card>
    </div>
  );
}

/** Back button + title row with the Copiloted badge. */
export function BuilderHeader({
  title,
  sub,
  onBack
}: {
  title: string;
  sub: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" icon={ArrowLeft} onClick={onBack}>
        Back
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">{title}</h1>
        <p className="text-[12px] text-fg-4">{sub}</p>
      </div>
      <Badge tone="azure" dot>
        Copiloted
      </Badge>
    </div>
  );
}

/** Earn's recommendation aside with the one-click apply. */
export function EarnAside({
  copilotSub,
  note,
  applied,
  applyLabel = "Apply Earn's recommendation",
  onApply,
  children
}: {
  copilotSub: string;
  note: string;
  applied: boolean;
  applyLabel?: string;
  onApply: () => void;
  children?: ReactNode;
}) {
  return (
    <Card className="self-start p-[17px]">
      <div className="mb-3 flex items-center gap-2.5">
        <EarnCoin size={32} online className="flex-none" />
        <div>
          <div className="text-[13px] font-semibold text-fg-1">Earn</div>
          <div className="text-[10.5px] text-fg-4">{copilotSub}</div>
        </div>
      </div>
      <div className="text-[12.5px] leading-relaxed text-fg-2">{note}</div>
      <Button
        variant={applied ? 'secondary' : 'gold'}
        size="sm"
        icon={applied ? Check : undefined}
        className="mt-3.5 w-full"
        onClick={onApply}
      >
        {applied ? 'Recommendation applied' : applyLabel}
      </Button>
      {children ?? (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-fg-5">
          <Hand size={12} aria-hidden />
          You&apos;re in control — change anything.
        </div>
      )}
    </Card>
  );
}
