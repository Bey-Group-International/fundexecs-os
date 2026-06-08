import type { LifecycleStage } from '@/lib/lifecycle';
import { compactMoney } from '@/lib/format';

/* ============================================================================
 * lib/loop-chain.ts — the operating loop as a *chain*, not four parked verbs.
 *
 * Phase 4 of the operating-loop fortification ("Earn that chains"): finishing a
 * link doesn't just check a box — it visibly charges the next. The rail's four
 * verbs (Build → Source → Run → Drive) become a connected sequence where the
 * current link is lit, the link it's about to unlock reads "on deck", and the
 * cleared links behind it read as charged. The loop wraps: a close in Drive
 * compounds back into Build (the capstone).
 *
 * Two signals drive it (per the design contract):
 *  - GATE CLEARANCE sets each link's structural state. The lifecycle engine
 *    already returns the current stage = the first uncleared gate, so every
 *    verb whose stages sit before the active one is, by construction, cleared.
 *  - ACTION COMPLETION fills the active link's charge meter (today's daily-
 *    command check-offs), so the handoff connector visibly fills toward the
 *    next verb as the operator does the work.
 *
 * Pure + deterministic at the lib root (outside `lib/queries/*`), reusing data
 * already on `DashboardData`. No loader, query, or migration.
 * ========================================================================= */

/** The four loop verbs — identical to the rail's `RailGroupKey`s, in order. */
export type LoopVerb = 'build' | 'source' | 'run' | 'drive';

export const LOOP_VERBS: readonly LoopVerb[] = ['build', 'source', 'run', 'drive'] as const;

export const LOOP_VERB_LABELS: Record<LoopVerb, string> = {
  build: 'Build',
  source: 'Source',
  run: 'Run',
  drive: 'Drive'
};

/**
 * Which verb owns each stage's forward frontier — the verb whose surface the
 * stage's gate is cleared *on*. `source_deals` ("Source & execute deals") gates
 * on an execution signal (diligence/deploy), so its frontier is Run, not Source.
 * This maps the seven lifecycle stages monotonically onto the four verbs.
 */
const STAGE_PRIMARY_VERB: Record<LifecycleStage, LoopVerb> = {
  establish_truth: 'build',
  get_raise_ready: 'build',
  source_lps: 'source',
  convert_lps: 'source',
  source_deals: 'run',
  operate: 'run',
  prove: 'drive'
};

/** Per-active-verb handoff copy — names the work and the link it charges next. */
const HANDOFF: Record<LoopVerb, string> = {
  build: 'Close the readiness gaps → opens Source',
  source: 'Build the pipeline → arms Run',
  run: 'Clear diligence → arms Drive',
  drive: 'Drive a close → compounds back into Build'
};

/** A link's place in the chain relative to the active frontier. */
export type LinkState = 'cleared' | 'active' | 'on_deck' | 'waiting';

/** Human label per state — drives titles/tooltips. */
export const LINK_STATE_LABEL: Record<LinkState, string> = {
  cleared: 'Cleared — charging the loop',
  active: 'Active — your focus now',
  on_deck: 'On deck — next to unlock',
  waiting: 'Waiting upstream'
};

/** One verb's link in the chain. */
export interface LoopLink {
  verb: LoopVerb;
  label: string;
  state: LinkState;
  /** 0–1 charge on the active link (action completion); 0 for other links. */
  charge: number;
}

export interface LoopChain {
  /** The four verbs, in loop order, each with its current state. */
  links: LoopLink[];
  /** The verb owning the current stage. */
  activeVerb: LoopVerb;
  /** The verb the active work charges next (wraps Drive → Build). */
  nextVerb: LoopVerb;
  /** 0–1 charge toward the handoff (action completion on the active stage). */
  charge: number;
  /** One-line handoff, e.g. "Clear diligence → arms Drive". */
  handoff: string;
  /** True when the active link is Drive — the loop is closing back into Build. */
  closing: boolean;
  /** The loop-closes capstone: names what a close fed forward. Present once
   *  capital has actually been committed (the loop has compounded at least once). */
  capstone?: string;
}

export interface LoopChainInputs {
  /** Current lifecycle stage (the first uncleared gate). */
  stage: LifecycleStage;
  /** Completed daily-command check-offs today. */
  dailyDone: number;
  /** Total daily-command items today. */
  dailyTotal: number;
  /** Realized committed capital — drives the loop-closes capstone. */
  committed: number;
  /** Current institutional-readiness score — capstone context. */
  readinessScore: number;
}

/**
 * Derive the visible loop chain from the current stage + action completion.
 * Gate clearance sets each link's state (cleared / active / on-deck / waiting);
 * action completion fills the active link's charge so the handoff connector
 * fills toward the next verb. Pure — safe to call in render or on the server.
 */
export function buildLoopChain(inputs: LoopChainInputs): LoopChain {
  const activeVerb = STAGE_PRIMARY_VERB[inputs.stage];
  const aIdx = LOOP_VERBS.indexOf(activeVerb);

  // Action completion → 0–1 charge on the active link.
  const charge =
    inputs.dailyTotal > 0 ? Math.max(0, Math.min(1, inputs.dailyDone / inputs.dailyTotal)) : 0;

  const links: LoopLink[] = LOOP_VERBS.map((verb, i) => {
    let state: LinkState;
    if (i < aIdx) state = 'cleared';
    else if (i === aIdx) state = 'active';
    else if (i === aIdx + 1) state = 'on_deck';
    else state = 'waiting';
    return { verb, label: LOOP_VERB_LABELS[verb], state, charge: state === 'active' ? charge : 0 };
  });

  // The loop wraps: Drive's "next" is Build — a close compounds into the record.
  const nextVerb = LOOP_VERBS[(aIdx + 1) % LOOP_VERBS.length];
  const closing = activeVerb === 'drive';

  const capstone =
    inputs.committed > 0
      ? `Your closes compounded — ${compactMoney(inputs.committed)} now backs your record (readiness ${inputs.readinessScore}/100).`
      : undefined;

  return {
    links,
    activeVerb,
    nextVerb,
    charge,
    handoff: HANDOFF[activeVerb],
    closing,
    capstone
  };
}
