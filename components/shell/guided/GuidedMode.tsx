'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { ArrowRight, Compass, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FX_EASE, FX_SPRING } from '@/components/dashboard/command/motion';
import type { RailMomentum } from '@/components/shell/Wave1SideRail';
import { LINK_STATE_LABEL, type LinkState, type LoopLink } from '@/lib/loop-chain';
import {
  getGuidedServerSnapshot,
  getGuidedSnapshot,
  setGuidedCollapsed,
  setGuidedOn,
  subscribeGuided
} from './guided-storage';

/* ----------------------------------------------------------------------------
 * GuidedMode (Phase 5) — the hand-on-the-wheel walkthrough.
 *
 * A shell-level focus overlay that drives the operating loop turn by turn. It
 * reuses the Phase-4 loop chain + the lifecycle gates as its step engine: the
 * current stage *is* the step, advancement is gate clearance (so the walkthrough
 * moves forward automatically as real fund state changes — no scripted tour).
 *
 * Two presentations, both persisted (UX-only, localStorage):
 *  - FOCUS CARD: dims the workspace and spotlights the active verb, the single
 *    next move, and what completing it unlocks. Taking the action minimizes to…
 *  - DOCKED PILL: a calm bottom-center companion so the operator can actually
 *    work the surface, with the loop position always in view. Tap to re-expand.
 *
 * Pure presentation over `momentum` (already on every authed shell via
 * AuthedShell → buildRailSignals). Renders nothing when disengaged or when a
 * route carries no momentum.
 * --------------------------------------------------------------------------*/

const STEP_DOT: Record<LinkState, string> = {
  cleared: 'bg-success',
  active: 'bg-azure-1 ring-2 ring-azure-1/30',
  on_deck: 'border border-azure-1 bg-transparent motion-safe:animate-pulse',
  waiting: 'bg-fg-5/40'
};

const STEP_TEXT: Record<LinkState, string> = {
  cleared: 'text-success/80',
  active: 'font-semibold text-azure-1',
  on_deck: 'text-azure-1/70',
  waiting: 'text-fg-5'
};

/** The four-verb stepper — the loop as a sequence with the active link lit. */
function LoopStepper({ links, closing }: { links: LoopLink[]; closing: boolean }) {
  return (
    <div className="flex items-start" data-testid="guided-stepper">
      {links.map((link, i) => {
        const state: LinkState = closing && link.verb === 'build' ? 'on_deck' : link.state;
        return (
          <div key={link.verb} className="contents">
            <div
              className="flex flex-none flex-col items-center gap-1.5"
              title={`${link.label} · ${LINK_STATE_LABEL[state]}`}
            >
              <span className={cn('h-2.5 w-2.5 rounded-full', STEP_DOT[state])} aria-hidden />
              <span
                className={cn(
                  'text-[9px] font-semibold uppercase tracking-[0.08em]',
                  STEP_TEXT[state]
                )}
              >
                {link.label}
              </span>
            </div>
            {i < links.length - 1 ? (
              <div
                className="mx-1.5 mt-[4px] h-px flex-1 overflow-hidden rounded-full bg-hairline"
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-azure-1"
                  style={{ width: link.state === 'cleared' ? '100%' : '0%' }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The full focus card — the spotlight on the current step. */
function FocusCard({ momentum }: { momentum: RailMomentum }) {
  const {
    chain,
    nextBestAction,
    stageLabel,
    stageIndex,
    stageCount,
    readinessScore,
    loopProgress
  } = momentum;
  if (!chain) return null;
  const chargePct = Math.round(Math.max(0, Math.min(1, chain.charge)) * 100);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: FX_EASE }}
    >
      {/* Backdrop — clicking it minimizes (keeps guided engaged). */}
      <button
        type="button"
        aria-label="Minimize guided mode"
        onClick={() => setGuidedCollapsed(true)}
        className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-[2px]"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Guided mode"
        data-testid="guided-focus-card"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={FX_SPRING}
        className="relative w-full max-w-md overflow-hidden rounded-[18px] border border-hairline bg-bg-1 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)]"
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Compass size={15} strokeWidth={2} aria-hidden className="flex-none text-gold-1" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-1">
            Guided
          </span>
          <span className="flex-1 text-[11px] text-fg-4">
            Step {Math.min(stageIndex + 1, stageCount)} of {stageCount}
          </span>
          <button
            type="button"
            onClick={() => setGuidedCollapsed(true)}
            aria-label="Minimize"
            className="flex h-6 w-6 items-center justify-center rounded-md text-fg-4 hover:bg-surface-1 hover:text-fg-1"
          >
            <Minus size={14} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setGuidedOn(false)}
            aria-label="Exit guided mode"
            data-testid="guided-exit"
            className="flex h-6 w-6 items-center justify-center rounded-md text-fg-4 hover:bg-surface-1 hover:text-fg-1"
          >
            <X size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="px-4 py-4">
          {/* Where you are */}
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-azure-1">
            You&apos;re here
          </p>
          <h2 className="mt-0.5 text-[18px] font-semibold tracking-[-0.01em] text-fg-1">
            {stageLabel}
          </h2>

          {/* The loop stepper */}
          <div className="mt-3.5">
            <LoopStepper links={chain.links} closing={chain.closing} />
          </div>

          {/* The one move now */}
          <div className="mt-4 rounded-[12px] border border-[var(--azure-line)] bg-[var(--azure-soft)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-azure-1/80">
              Do this now
            </p>
            <p className="mt-1 text-[13px] font-medium text-fg-1">
              {nextBestAction ? nextBestAction.title : chain.handoff}
            </p>
            {nextBestAction ? (
              <Link
                href={nextBestAction.href}
                onClick={() => setGuidedCollapsed(true)}
                data-testid="guided-cta"
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-[9px] bg-azure-1 px-3 py-1.5 text-[12px] font-semibold text-white transition-transform hover:translate-x-0.5"
              >
                {nextBestAction.cta}
                <ArrowRight size={13} strokeWidth={2.4} aria-hidden />
              </Link>
            ) : null}
          </div>

          {/* What it unlocks */}
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-fg-3">
            <ArrowRight
              size={12}
              strokeWidth={2.4}
              aria-hidden
              className="mt-[1px] flex-none text-azure-1"
            />
            <span className="min-w-0 flex-1">{chain.handoff}</span>
          </p>

          {/* Loop telemetry */}
          <div className="mt-4 flex items-center gap-3 border-t border-hairline pt-3 text-[10px] text-fg-4">
            <span className="tabular-nums">
              Readiness <span className="font-semibold text-fg-2">{readinessScore}</span>/100
            </span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              Loop <span className="font-semibold text-fg-2">{loopProgress}%</span>
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-[0.08em]">Today</span>
              <span className="h-1 w-12 overflow-hidden rounded-full bg-hairline">
                <span
                  className="block h-full rounded-full bg-azure-1"
                  style={{ width: `${chargePct}%` }}
                />
              </span>
            </span>
          </div>

          {chain.capstone ? (
            <p
              className={cn(
                'mt-3 text-[10px] leading-snug',
                chain.closing ? 'text-gold-1' : 'text-fg-4'
              )}
            >
              {chain.capstone}
            </p>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** The minimized companion — keeps the loop position in view while you work. */
function DockedPill({ momentum }: { momentum: RailMomentum }) {
  const { chain, stageIndex, stageCount, loopProgress } = momentum;
  const activeLabel = chain ? chain.links.find((l) => l.state === 'active')?.label : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={FX_SPRING}
      className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 lg:left-[calc(50%+126px)]"
    >
      <div
        data-testid="guided-pill"
        className="flex items-center gap-2.5 rounded-full border border-[var(--gold-line)] bg-bg-1/95 py-1.5 pl-3 pr-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)] backdrop-blur"
      >
        <button
          type="button"
          onClick={() => setGuidedCollapsed(false)}
          data-testid="guided-pill-expand"
          aria-label="Open guided mode"
          className="flex items-center gap-2 text-left"
        >
          <Compass size={14} strokeWidth={2} aria-hidden className="flex-none text-gold-1" />
          <span className="text-[11px] font-semibold text-fg-1">Guided</span>
          {activeLabel ? (
            <span className="text-[11px] text-fg-4">
              · {activeLabel} · step {Math.min(stageIndex + 1, stageCount)}/{stageCount}
            </span>
          ) : null}
          <span className="ml-1 h-1 w-14 overflow-hidden rounded-full bg-hairline" aria-hidden>
            <span
              className="block h-full rounded-full bg-azure-1"
              style={{ width: `${loopProgress}%` }}
            />
          </span>
        </button>
        <button
          type="button"
          onClick={() => setGuidedOn(false)}
          aria-label="Exit guided mode"
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-fg-4 hover:bg-surface-1 hover:text-fg-1"
        >
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Shell-mounted guided overlay. Reads the persisted on/collapsed state and the
 * live `momentum`; renders the focus card or the docked pill accordingly, or
 * nothing when disengaged / when the route carries no loop signal.
 */
export function GuidedMode({ momentum }: { momentum?: RailMomentum }) {
  const state = useSyncExternalStore(subscribeGuided, getGuidedSnapshot, getGuidedServerSnapshot);

  const active = state.on && !!momentum?.chain;

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {active && momentum ? (
          state.collapsed ? (
            <DockedPill key="pill" momentum={momentum} />
          ) : (
            <FocusCard key="card" momentum={momentum} />
          )
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}

export default GuidedMode;
