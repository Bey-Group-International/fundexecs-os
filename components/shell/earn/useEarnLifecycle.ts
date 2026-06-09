'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * The six phases of an Earn turn, in order of progression.
 *
 *   idle       — no turn in flight; the chat is at rest.
 *   routing    — the request was sent; we're waiting for the first byte back.
 *   retrieving — a `sources` event arrived; Earn is consulting the brains.
 *   streaming  — the first `delta` arrived; the reply is composing in real time.
 *   proposing  — an `action` event arrived; Earn is proposing a next step.
 *   settled    — the `done` event (or stream end); a brief flourish, then rest.
 *
 * A turn moves forward through these phases but never backward.
 * Multiple events of the same type advance only if the phase hasn't passed that
 * point yet (e.g. a second `delta` won't move from `streaming` back to
 * `retrieving`).
 */
export type EarnPhase = 'idle' | 'routing' | 'retrieving' | 'streaming' | 'proposing' | 'settled';

/** Numeric rank keeps phase-advancement logic simple. Higher = further along. */
const PHASE_RANK: Record<EarnPhase, number> = {
  idle: 0,
  routing: 1,
  retrieving: 2,
  streaming: 3,
  proposing: 4,
  settled: 5
};

/** Event types emitted by `applyEvent` in EarnChat that drive the lifecycle.
 *  Other event types (e.g. `credit`) are ignored — `onEvent` no-ops on them. */
export type EarnEventType = 'sources' | 'delta' | 'action' | 'degraded' | 'done';

export interface UseEarnLifecycleReturn {
  /** Current phase of the Earn turn lifecycle. */
  phase: EarnPhase;
  /**
   * Call when a streaming event arrives inside `applyEvent`. Maps event type
   * to the appropriate lifecycle phase — only advances, never retreats.
   * Unknown event types are ignored.
   */
  onEvent: (type: string) => void;
  /**
   * Call at the top of `send` (before the fetch) to enter the `routing` phase.
   * Resets any previous turn's lifecycle state first.
   */
  begin: () => void;
  /**
   * Call when loading is set to `false` (stream end or error) to ensure the
   * lifecycle settles cleanly, then returns to idle after a short flourish.
   */
  settle: () => void;
}

/**
 * useEarnLifecycle — a small, pure-React state machine for the Earn chat turn.
 *
 * Usage:
 *   const lifecycle = useEarnLifecycle();
 *   // in send():
 *   lifecycle.begin();
 *   // in applyEvent():
 *   lifecycle.onEvent(evt.type);
 *   // in finally:
 *   lifecycle.settle();
 *
 * The hook owns a cleanup timer so the `settled` phase is transient — the UI
 * shows a brief flourish then the phase returns to `idle` automatically.
 */
export function useEarnLifecycle(): UseEarnLifecycleReturn {
  const [phase, setPhase] = useState<EarnPhase>('idle');
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Advance to `next` only if it ranks higher than the current phase. */
  const advanceTo = useCallback((next: EarnPhase) => {
    setPhase((current) => {
      if (PHASE_RANK[next] > PHASE_RANK[current]) return next;
      return current;
    });
  }, []);

  const begin = useCallback(() => {
    // Clear any pending settle timer from a previous turn.
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    setPhase('routing');
  }, []);

  const onEvent = useCallback(
    (type: string) => {
      switch (type) {
        case 'sources':
          advanceTo('retrieving');
          break;
        case 'delta':
          advanceTo('streaming');
          break;
        case 'action':
          advanceTo('proposing');
          break;
        case 'degraded':
          // Degraded falls back to streaming visual (text composing, calm).
          advanceTo('streaming');
          break;
        case 'done':
          advanceTo('settled');
          break;
        // Any other event type (e.g. `credit`) does not move the lifecycle.
      }
    },
    [advanceTo]
  );

  const settle = useCallback(() => {
    // Ensure we reach `settled` (handles streams that end without a `done` event).
    setPhase((current) => (current !== 'idle' ? 'settled' : 'idle'));
    // Return to idle after the flourish window (700 ms — enough for a spring).
    settleTimer.current = setTimeout(() => {
      setPhase('idle');
      settleTimer.current = null;
    }, 700);
  }, []);

  return { phase, onEvent, begin, settle };
}
