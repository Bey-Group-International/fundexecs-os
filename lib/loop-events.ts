import type { LoopVerb } from '@/lib/loop-chain';
import type { LoopCloseSource } from '@/lib/loop-close';

/**
 * lib/loop-events.ts — per-verb instrumentation vocabulary (pure).
 *
 * The `loop_events` stream records the operating loop as data: which verb
 * fired, what event, against which entity. This module is the shared
 * vocabulary — verb attribution for execution events and the well-known event
 * names — kept pure (no IO) so both the emitter and future readers agree on
 * one spelling. The writer lives in `lib/loop-events.server.ts`.
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
  loopClosed: 'loop_closed'
} as const;

export type LoopEventType = (typeof LOOP_EVENT_TYPES)[keyof typeof LOOP_EVENT_TYPES];
