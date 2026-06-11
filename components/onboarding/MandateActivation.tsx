'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ACTIVATION_ORDER,
  activationHeadline,
  specialistById,
  workspaceStats,
  type Mandate
} from '@/lib/onboarding/mandate';
import { MandateIcon } from '@/components/ui/MandateIcon';
import { AuroraBackdrop } from '@/components/ui/AuroraBackdrop';
import { Button } from '@/components/ui/Button';
import { EarnCoin } from '@/components/ui/EarnCoin';

const REVEAL_MS = 720;

const STAT_TONES: Record<string, string> = {
  gold: 'text-gold-1',
  azure: 'text-azure-1',
  success: 'text-success',
  info: 'text-info'
};

/**
 * Team activation — the onboarding "aha". While the server settles the
 * workspace, the specialists reveal one by one with what each just built
 * from the mandate; then the "what got built" tiles and the door into the
 * command center. Cosmetic by design (the real work happened in the brief's
 * server action).
 */
export function MandateActivation({ mandate, onDone }: { mandate: Mandate; onDone: () => void }) {
  const [revealed, setRevealed] = useState(0);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= ACTIVATION_ORDER.length) {
        clearInterval(timer);
        setTimeout(() => setComplete(true), 700);
      }
    }, REVEAL_MS);
    return () => clearInterval(timer);
  }, []);

  const stats = workspaceStats(mandate);
  const pct = Math.round((revealed / ACTIVATION_ORDER.length) * 100);

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-bg-0 px-6 py-10 text-fg-1">
      <AuroraBackdrop />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(40% 34% at 50% 18%, rgba(247,201,72,0.1), transparent 70%)'
        }}
      />

      <div className="fx-rise relative z-10 w-full max-w-[640px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative mb-4">
            <div
              aria-hidden
              className={cn(
                'absolute -inset-3 rounded-full blur-[10px]',
                !complete && 'fx-glow-pulse'
              )}
              style={{
                background: 'radial-gradient(circle, rgba(247,201,72,0.5), transparent 70%)'
              }}
            />
            <div className="relative">
              <EarnCoin size={64} />
            </div>
          </div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" aria-live="polite">
            {complete ? activationHeadline(mandate) : 'Earn is briefing the team…'}
          </h1>
          <p className="mt-2 max-w-[460px] text-[13.5px] leading-relaxed text-fg-3">
            {complete
              ? 'The team built your workspace from the mandate. Everything below is a starting point you can change anytime.'
              : 'No forms, no setup. Watch your executive team turn the mandate into a working desk.'}
          </p>
        </div>

        {!complete ? (
          <>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Team activation"
            >
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#F7C948,#E5A823)] transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-4 flex flex-col gap-0.5 rounded-2xl border border-hairline bg-bg-1 p-3 shadow-[var(--shadow-md)]">
              {ACTIVATION_ORDER.slice(0, revealed + 1).map((id, i) => {
                const specialist = specialistById(id);
                if (!specialist || i >= ACTIVATION_ORDER.length) return null;
                const inFlight = i === revealed;
                if (i > revealed) return null;
                return (
                  <div key={id} className="fx-rise flex items-center gap-3 px-2 py-2">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1">
                      <MandateIcon name={specialist.icon} size={15} strokeWidth={1.9} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-fg-1">
                        {specialist.name}{' '}
                        <span className="text-[11.5px] font-normal text-fg-5">
                          · {specialist.title}
                        </span>
                      </div>
                      <div className="mt-px text-[12px] text-fg-3">{specialist.build}</div>
                    </div>
                    {inFlight ? (
                      <Loader2 size={15} className="animate-spin text-gold-1" aria-hidden />
                    ) : (
                      <CheckCircle2 size={16} className="text-success" aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="fx-rise">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((s) => {
                return (
                  <div
                    key={s.label}
                    className="rounded-2xl border border-hairline bg-surface-1 px-3.5 py-3.5"
                  >
                    <MandateIcon
                      name={s.icon}
                      size={17}
                      strokeWidth={1.9}
                      className={STAT_TONES[s.tone] ?? 'text-fg-3'}
                      aria-hidden
                    />
                    <div className="mt-2.5 text-[24px] font-semibold tracking-[-0.02em] [font-feature-settings:'tnum']">
                      {s.value}
                    </div>
                    <div className="mt-1 text-[12px] font-medium text-fg-2">{s.label}</div>
                    <div className="mt-px text-[11px] text-fg-5">{s.sub}</div>
                  </div>
                );
              })}
            </div>
            <Button variant="gold" size="lg" onClick={onDone} className="mt-5 w-full">
              Enter your command center
              <ArrowRight size={16} aria-hidden />
            </Button>
            <p className="mt-3 text-center text-[11.5px] text-fg-5">
              15 specialists now on your desk · the team works around the clock
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
