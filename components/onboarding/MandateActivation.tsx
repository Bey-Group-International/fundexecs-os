'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  Compass,
  Database,
  Handshake,
  Landmark,
  ListChecks,
  Loader2,
  Radar,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon
} from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { FX_EASE, MOTION_DURATIONS_S } from '@/components/dashboard/command/motion';
import { cn } from '@/lib/utils';
import {
  ACTIVATION_ORDER,
  activationHeadline,
  specialistById,
  workspaceStats,
  type Mandate,
  type WorkspaceStat
} from '@/lib/onboarding/mandate';

/* ── icon resolver — the activation roster + stat tiles use a small set ───── */
const ICONS: Record<string, LucideIcon> = {
  'list-checks': ListChecks,
  database: Database,
  compass: Compass,
  radar: Radar,
  landmark: Landmark,
  'arrow-left-right': ArrowLeftRight,
  scale: Scale,
  users: Users,
  handshake: Handshake,
  'shield-check': ShieldCheck
};
function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Sparkles;
}

/* The icon tint per stat tone — keyed to the design-system CSS tokens. */
const TONE: Record<WorkspaceStat['tone'], string> = {
  gold: 'var(--gold-1)',
  azure: 'var(--accent)',
  success: 'var(--success)',
  info: 'var(--accent)'
};

export interface MandateActivationProps {
  mandate: Mandate;
  /** Enter the command center once the desk is built. */
  onDone: () => void;
}

/**
 * MandateActivation — the "aha" payoff after the brief: Earn reveals each
 * specialist turning the mandate into a working desk, one by one, then the
 * desk-ready stats land with a single CTA into the command center.
 *
 * Reduced-motion safe: when the OS prefers reduced motion the reveal collapses
 * to the finished state immediately (no staged timers, no spinner), so the
 * operator still sees the built desk and the CTA without animation.
 */
export function MandateActivation({ mandate, onDone }: MandateActivationProps) {
  const reduced = useReducedMotion() ?? false;
  const order = ACTIVATION_ORDER;
  const [revealed, setRevealed] = useState(reduced ? order.length : 0);
  const [complete, setComplete] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= order.length) {
        clearInterval(timer);
        setTimeout(() => setComplete(true), 700);
      }
    }, 720);
    return () => clearInterval(timer);
  }, [reduced, order.length]);

  const stats = workspaceStats(mandate);
  const pct = Math.round((revealed / order.length) * 100);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg-0 px-6 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(42% 34% at 50% 16%, rgba(247,201,72,0.10), transparent 70%)'
        }}
      />
      <div className="relative z-[1] w-full max-w-[640px]">
        {/* Earn */}
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="relative mb-4">
            <motion.div
              aria-hidden
              className="absolute -inset-3 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(247,201,72,0.5), transparent 70%)',
                filter: 'blur(10px)'
              }}
              animate={reduced || complete ? { opacity: 0.6 } : { opacity: [0.35, 0.7, 0.35] }}
              transition={{
                duration: MOTION_DURATIONS_S.orbPulse,
                repeat: complete || reduced ? 0 : Infinity,
                ease: 'easeInOut'
              }}
            />
            <div className="relative">
              <EarnCoin size={66} />
            </div>
          </div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-fg-1">
            {complete ? activationHeadline(mandate) : 'Earn is briefing the team…'}
          </h1>
          <p className="mt-2 max-w-[460px] text-[13.5px] leading-relaxed text-fg-3">
            {complete
              ? 'The team built your workspace from the mandate. Everything below is a starting point you can change anytime.'
              : 'No forms, no setup. Watch your executive team turn the mandate into a working desk.'}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {!complete ? (
            <motion.div
              key="building"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: reduced ? 0 : -8 }}
              transition={{ duration: MOTION_DURATIONS_S.standard, ease: FX_EASE }}
            >
              {/* progress */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <motion.div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#F7C948,#E5A823)]"
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5, ease: FX_EASE }}
                />
              </div>

              <Card className="mt-4 flex flex-col gap-0.5 p-3">
                {order.map((id, i) => {
                  if (i >= revealed) return null;
                  const m = specialistById(id);
                  if (!m) return null;
                  const Ico = iconFor(m.icon);
                  const working = i === revealed - 1;
                  return (
                    <motion.div
                      key={id}
                      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: MOTION_DURATIONS_S.quick, ease: FX_EASE }}
                      className="flex items-center gap-3 px-2 py-2.5"
                    >
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
                        <Ico size={15} strokeWidth={1.9} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-fg-1">
                          {m.name}{' '}
                          <span className="text-[11.5px] font-normal text-fg-5">· {m.title}</span>
                        </div>
                        <div className="mt-0.5 text-[12px] leading-snug text-fg-3">{m.build}</div>
                      </div>
                      {working ? (
                        <Loader2
                          size={15}
                          className="flex-none animate-spin text-gold-1"
                          aria-hidden
                        />
                      ) : (
                        <CheckCircle2 size={16} className="flex-none text-success" aria-hidden />
                      )}
                    </motion.div>
                  );
                })}
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="ready"
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: MOTION_DURATIONS_S.celebrate, ease: FX_EASE }}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stats.map((s) => {
                  const Ico = iconFor(s.icon);
                  return (
                    <div
                      key={s.label}
                      className="rounded-[14px] border border-hairline bg-surface-1 p-3.5"
                    >
                      <Ico
                        size={17}
                        strokeWidth={1.9}
                        style={{ color: TONE[s.tone] }}
                        aria-hidden
                      />
                      <div className="mt-2.5 text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                        {s.value}
                      </div>
                      <div className="mt-0.5 text-[12px] font-medium text-fg-2">{s.label}</div>
                      <div className="mt-0.5 text-[11px] text-fg-5">{s.sub}</div>
                    </div>
                  );
                })}
              </div>

              <Button
                variant="gold"
                size="lg"
                iconRight={ArrowRight}
                onClick={onDone}
                className={cn('mt-5 w-full')}
              >
                Enter your command center
              </Button>
              <p className="mt-3 text-center text-[11.5px] text-fg-5">
                Your executive team is now on the desk · working around the clock
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
