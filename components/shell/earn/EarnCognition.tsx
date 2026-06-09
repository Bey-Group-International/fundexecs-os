'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BookOpen, Check, ArrowRight } from 'lucide-react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { TeamAvatar } from '@/lib/team';
import { getMember } from '@/lib/team/roster';
import { handOffLine } from '@/lib/team/cognition-copy';
import { FX_EASE, FX_SPRING } from '@/components/dashboard/command/motion';
import { cn } from '@/lib/utils';
import type { EarnPhase } from './useEarnLifecycle';

/* ============================================================================
 * EarnCognition — the phase-aware thinking indicator for the Earn chat.
 *
 * Replaces the static "Earn is thinking…" block with intentional, phased
 * motion that maps to what is actually happening in the AI pipeline:
 *
 *   routing     → soft pulsing ring around the Earn coin (request in flight)
 *   handing_off → a named specialist is being routed to; calm desk transition
 *                 (DORMANT in phase 2 — see the dev-trigger seam below)
 *   retrieving  → source brain chips stagger in (Earn consults the desk)
 *   streaming   → breathing shimmer on the composing caret (reply arriving)
 *   proposing   → already visible via the action card; indicator yields
 *   settled     → a brief spring-settle check, then gone
 *   idle        → nothing rendered
 *
 * The component is purely presentational. It is shown/hidden by the caller
 * (EarnChat) based on the current lifecycle phase.
 *
 * Accessibility: aria-live="polite" + role="status" keeps assistive
 * technology informed. Under prefers-reduced-motion all animations collapse
 * to a simple opacity transition or static state so the indicator stays
 * understandable without motion.
 *
 * Motion grammar: easing + spring physics come from the shared
 * `components/dashboard/command/motion.ts` JS twins (FX_EASE, FX_SPRING).
 * Local timings on motion/react components are kept declarative; the CSS
 * sibling animations on .fx-* classes handle their own reduced-motion
 * treatment via the meaningful-tier rules in app/globals.css.
 * ========================================================================= */

/* ── Brain-chip placeholder names shown while Earn retrieves context ─────── */
const BRAIN_LABELS = ['Mandate', 'Pipeline', 'Capital', 'LP Intel'] as const;

/* ── Sub-components ─────────────────────────────────────────────────────── */

/** The animated ring that pulses around the Earn coin during `routing`. */
function RoutingRing({ reduced }: { reduced: boolean }) {
  if (reduced) {
    // Static hint — no animation, still communicates "routing".
    return (
      <span
        className="absolute -inset-1.5 rounded-full border border-[var(--gold-line)] opacity-60"
        aria-hidden
      />
    );
  }
  return (
    <motion.span
      className="absolute -inset-1.5 rounded-full border border-[var(--gold-line)]"
      aria-hidden
      animate={{ opacity: [0.3, 0.75, 0.3], scale: [0.94, 1.04, 0.94] }}
      transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity, repeatType: 'loop' }}
    />
  );
}

/** Three-dot breathing indicator shown during `routing` before sources arrive. */
function ThinkDots({ reduced }: { reduced: boolean }) {
  return (
    <span aria-hidden className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn('inline-block h-1 w-1 rounded-full bg-gold-1', !reduced && 'fx-earn-think')}
          style={reduced ? undefined : { animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}

/** Source-brain chips that stagger in during `retrieving`. */
function BrainChips({ reduced }: { reduced: boolean }) {
  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.07, delayChildren: 0 } }
  };
  const item = {
    hidden: { opacity: 0, y: reduced ? 0 : 6 },
    show: { opacity: 1, y: 0, transition: { duration: 0.36, ease: FX_EASE } }
  };

  return (
    <motion.div
      className="flex flex-wrap gap-1"
      variants={container}
      initial="hidden"
      animate="show"
      aria-label="Consulting knowledge sources"
    >
      {BRAIN_LABELS.map((label) => (
        <motion.span
          key={label}
          variants={item}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-1.5 py-0.5 text-[9.5px] font-medium text-gold-1"
        >
          <BookOpen size={9} strokeWidth={2} aria-hidden />
          {label}
        </motion.span>
      ))}
    </motion.div>
  );
}

/** Subtle caret shimmer shown while the reply is composing (`streaming`). */
function StreamingCaret({ reduced }: { reduced: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[12px] text-fg-3">Composing</span>
      <motion.span
        className="inline-block h-3.5 w-px rounded-full bg-gold-1"
        aria-hidden
        animate={reduced ? { opacity: 1 } : { opacity: [1, 0, 1] }}
        transition={reduced ? undefined : { duration: 0.9, ease: 'easeInOut', repeat: Infinity }}
      />
    </span>
  );
}

/** Brief spring check-mark flourish shown at `settled` before yielding to idle. */
function SettledCheck({ reduced }: { reduced: boolean }) {
  return (
    <motion.span
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)]"
      aria-label="Response ready"
      initial={{ opacity: 0, scale: reduced ? 1 : 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: reduced ? 1 : 0.8 }}
      transition={reduced ? { duration: 0.15 } : { ...FX_SPRING }}
    >
      <Check size={11} strokeWidth={2.4} className="text-gold-1" aria-hidden />
    </motion.span>
  );
}

/** Hand-off treatment: the named specialist's avatar + a single status line.
 *  Phase 2 keeps this dormant — fires only via the dev-trigger seam below. */
function HandingOffBlock({ slug, reduced }: { slug: string | null | undefined; reduced: boolean }) {
  const member = slug ? getMember(slug) : null;
  const line = handOffLine(slug);
  return (
    <div className="flex items-center gap-2">
      {member ? (
        <span className={cn('relative flex-none', !reduced && 'fx-onpoint-pulse rounded-full')}>
          <TeamAvatar member={member} size={20} />
        </span>
      ) : null}
      <span className={cn('text-[12px] text-fg-3', !reduced && 'fx-status-fade')}>{line}</span>
      <ArrowRight size={11} strokeWidth={2} className="text-fg-4" aria-hidden />
    </div>
  );
}

/* ── Phase label copy ────────────────────────────────────────────────────── */
const PHASE_LABEL: Record<EarnPhase, string> = {
  idle: '',
  routing: 'Earn is consulting the desk',
  handing_off: 'Routing to a specialist',
  retrieving: 'Reviewing knowledge sources',
  streaming: 'Earn is responding',
  proposing: 'Earn is proposing a next step',
  settled: 'Done'
};

/* ── Dev-trigger seam (NON-PRODUCTION ONLY) ─────────────────────────────────
 *  Lets a reviewer exercise the `handing_off` render today, before phase 5
 *  wires the real stream event. Reads the URL on mount and again on
 *  popstate; if `?earn_phase=handing_off&earn_specialist=<slug>` is set,
 *  returns an override the renderer applies.
 *
 *  Compiles out in production: the body checks
 *  `process.env.NODE_ENV !== 'production'` (Next inlines this at build, so
 *  the entire effect body is dead-code-eliminated in prod bundles). On the
 *  off chance it ever leaked, an unprivileged user toggling a query string
 *  can only cause a presentational render — no AI call, no data mutation.
 *  ─────────────────────────────────────────────────────────────────────── */
function useEarnCognitionDevOverride(): { phase: EarnPhase; specialistSlug: string | null } | null {
  const [override, setOverride] = useState<{
    phase: EarnPhase;
    specialistSlug: string | null;
  } | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (typeof window === 'undefined') return;

    const read = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const phaseParam = params.get('earn_phase');
        const slugParam = params.get('earn_specialist');
        // Only honor a recognized phase string. Anything else clears the override.
        const valid: EarnPhase[] = [
          'idle',
          'routing',
          'handing_off',
          'retrieving',
          'streaming',
          'proposing',
          'settled'
        ];
        if (phaseParam && (valid as string[]).includes(phaseParam)) {
          setOverride({ phase: phaseParam as EarnPhase, specialistSlug: slugParam });
        } else {
          setOverride(null);
        }
      } catch {
        setOverride(null);
      }
    };

    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  return override;
}

/* ── Main component ─────────────────────────────────────────────────────── */

export interface EarnCognitionProps {
  /** Current turn phase from useEarnLifecycle. */
  phase: EarnPhase;
  /** Specialist slug when `phase === 'handing_off'`. Ignored at other phases. */
  specialistSlug?: string | null;
  className?: string;
}

/**
 * EarnCognition — renders the live thinking/composing indicator for the active
 * turn phase. Mount it wherever the old static "Earn is thinking…" block lived.
 * Set phase="idle" to hide it entirely.
 *
 * Each phase transition animates via AnimatePresence so the swap is a smooth
 * handoff, not a hard cut.
 */
export function EarnCognition({ phase, specialistSlug, className }: EarnCognitionProps) {
  const reduced = useReducedMotion() ?? false;
  // Dev-only seam — overrides props from `?earn_phase=...&earn_specialist=...`.
  // No-op in production builds (Next inlines NODE_ENV at build time).
  const devOverride = useEarnCognitionDevOverride();
  const effectivePhase = devOverride?.phase ?? phase;
  const effectiveSlug = devOverride?.specialistSlug ?? specialistSlug ?? null;
  const label = PHASE_LABEL[effectivePhase];

  if (effectivePhase === 'idle') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn('fx-rise flex items-start gap-2.5', className)}
    >
      {/* Earn avatar with phase-specific ring */}
      <span className="relative mt-0.5 flex-none">
        <EarnCoin size={24} online />
        <AnimatePresence>
          {effectivePhase === 'routing' && <RoutingRing key="ring" reduced={reduced} />}
        </AnimatePresence>
      </span>

      {/* Phase body — swaps smoothly as the turn advances */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Screen-reader-visible status text */}
        <span className="sr-only">{label}</span>

        <AnimatePresence mode="wait">
          {effectivePhase === 'routing' && (
            <motion.div
              key="routing"
              className="flex items-center gap-2 text-[12px] text-fg-3"
              initial={{ opacity: 0, y: reduced ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -4 }}
              transition={{ duration: 0.25, ease: FX_EASE }}
            >
              <span>Earn is consulting the desk</span>
              <ThinkDots reduced={reduced} />
            </motion.div>
          )}

          {effectivePhase === 'handing_off' && (
            <motion.div
              key="handing_off"
              className="flex flex-col gap-1.5"
              initial={{ opacity: 0, y: reduced ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: FX_EASE }}
            >
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Routing to a specialist
              </span>
              <HandingOffBlock slug={effectiveSlug} reduced={reduced} />
            </motion.div>
          )}

          {effectivePhase === 'retrieving' && (
            <motion.div
              key="retrieving"
              className="flex flex-col gap-1.5"
              initial={{ opacity: 0, y: reduced ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: FX_EASE }}
            >
              <span className="text-[12px] text-fg-3">Reviewing knowledge sources</span>
              <BrainChips reduced={reduced} />
            </motion.div>
          )}

          {effectivePhase === 'streaming' && (
            <motion.div
              key="streaming"
              initial={{ opacity: 0, y: reduced ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: FX_EASE }}
            >
              <StreamingCaret reduced={reduced} />
            </motion.div>
          )}

          {/* `proposing` — the action card itself is the indicator; show a
              calm label so there's a status update for assistive technology. */}
          {effectivePhase === 'proposing' && (
            <motion.div
              key="proposing"
              className="text-[12px] text-fg-3"
              initial={{ opacity: 0, y: reduced ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: FX_EASE }}
            >
              Earn is proposing a next step
            </motion.div>
          )}

          {effectivePhase === 'settled' && (
            <motion.div
              key="settled"
              className="flex items-center gap-1.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <SettledCheck reduced={reduced} />
              <span className="text-[11px] text-fg-4">Done</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default EarnCognition;
