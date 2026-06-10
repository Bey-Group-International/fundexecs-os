import type { LoopVerb } from '@/lib/loop-chain';
import type { LoopCloseSource } from '@/lib/loop-close';

/**
 * lib/loop-events.ts — per-verb instrumentation vocabulary (pure).
 *
 * The `loop_events` stream records the operating loop as data: which verb
 * fired, what event, against which entity. This module is the shared
 * vocabulary — verb attribution for execution events and the well-known event
 * names — kept pure (no IO) so both the emitter and readers agree on one
 * spelling. The writer lives in `lib/loop-events.server.ts`; the pulse
 * aggregation that reads the stream lives in `lib/loop-pulse.ts`.
 */

/**
 * Which loop verb each execution event belongs to. Completed diligence is the
 * RUN verb doing its job; a closed deal or closed capital is DRIVE finishing
 * (and compounding back into Build via recordLoopClose).
 */
export const LOOP_SOURCE_VERB: Record<LoopCloseSource, LoopVerb> = {
  diligence_completed: 'run',
  deal_closed: 'drive',
  capital_closed: 'drive'
};

/** Well-known event names on the stream. Keep additions short + snake_case. */
export const LOOP_EVENT_TYPES = {
  /** An execution event closed the loop (mirrors the trust_events ledger). */
  loopClosed: 'loop_closed',
  /** A new deal entered the funnel (Source doing its job). */
  dealCreated: 'deal_created',
  /** A deal moved stage — the funnel's heartbeat, attributed per verb. */
  dealStage: 'deal_stage'
} as const;

export type LoopEventType = (typeof LOOP_EVENT_TYPES)[keyof typeof LOOP_EVENT_TYPES];

/**
 * Which verb owns each deal stage's movement — the funnel mapped onto the
 * loop. Top-of-funnel stages are Source finding fit; diligence/IC are Run
 * deciding; the close-out stages are Drive executing.
 */
export const DEAL_STAGE_VERB: Record<string, LoopVerb> = {
  sourcing: 'source',
  screening: 'source',
  visitor: 'source',
  prospect: 'source',
  qualified: 'source',
  meeting: 'source',
  diligence: 'run',
  ic: 'run',
  'soft-circle': 'drive',
  execution: 'drive',
  closing: 'drive',
  committed: 'drive',
  closed: 'drive'
};
