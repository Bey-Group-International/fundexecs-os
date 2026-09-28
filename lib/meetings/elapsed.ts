// lib/meetings/elapsed.ts
// How long something has been running, measured rather than counted.
//
// There are two ways to answer "how long has this meeting been going", and only
// one of them is right.
//
// The wrong one increments a counter on a one-second interval. It reads as
// obviously correct and it is not: setInterval guarantees a callback no EARLIER
// than the delay, never that it arrives on time, so every late fire is time the
// counter never gets back. In a meeting room that is not a rare event — the main
// thread is already carrying WebRTC decode, an analyser sampling every 120ms,
// speech recognition, and (with a background effect on) a canvas composite per
// frame. A browser that backgrounds the tab throttles the timer further. The
// counter therefore runs SLOW, by an amount nobody can predict, and the number
// it lands on is what gets written to the meeting report as the meeting's
// length: the institutional record of a call, short by an unknown margin.
//
// The right one records WHEN each live stretch began and ended, and subtracts.
// A late callback then costs nothing, because the answer was never assembled
// from the callbacks — they only decide when to look. `useRecording` has always
// done it this way for the recording's own clock (`Date.now() - run.startedAt`).
// This is the same arithmetic, generalised to something that can pause: a call
// that drops and recovers is live, then not, then live again, and only the live
// stretches are the meeting.
//
// Feed it a MONOTONIC reading — `monotonicNow()` below. Wall-clock time can move
// backwards (an NTP correction, somebody fixing their system clock mid-call) and
// a duration that goes down is worse than one that drifts. The spans are clamped
// anyway, because a defensive floor costs one comparison.

/**
 * One stretch of live time. `to === null` means it is still running.
 */
export interface LiveSpan {
  from: number;
  to: number | null;
}

/**
 * Every live stretch so far, and whether one is open.
 *
 * Kept as spans rather than a running total because a total cannot answer "is
 * it live right now?", and the two have to agree — the clock on screen is read
 * far more often than it is advanced.
 */
export interface ElapsedState {
  /** Stretches that have ended, oldest first. */
  spans: readonly LiveSpan[];
  /** When the current stretch began, or null when nothing is running. */
  openedAt: number | null;
}

export const NO_ELAPSED: ElapsedState = { spans: [], openedAt: null };

/**
 * A clock that only goes forward.
 *
 * `performance.now()` is monotonic and unaffected by system clock changes, which
 * is exactly the property a duration needs. It is missing in some test and
 * server environments, so wall clock stands in — the clamp below covers the
 * difference.
 */
export function monotonicNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/** Is a live stretch open right now? */
export function isRunning(state: ElapsedState): boolean {
  return state.openedAt !== null;
}

/**
 * Begin a live stretch.
 *
 * Idempotent: starting something already running keeps the ORIGINAL start,
 * rather than resetting it. The effect that drives this re-runs whenever its
 * dependencies change, and a restart that moved the start forward would quietly
 * erase everything before it.
 */
export function startSpan(state: ElapsedState, now: number): ElapsedState {
  if (state.openedAt !== null) return state;
  return { spans: state.spans, openedAt: now };
}

/**
 * End the open stretch and bank it.
 *
 * Idempotent in the other direction: stopping something already stopped is not
 * an error, because a cleanup can run after the state has already closed.
 * A span that would be negative (a clock that moved backwards) banks as zero.
 */
export function stopSpan(state: ElapsedState, now: number): ElapsedState {
  if (state.openedAt === null) return state;
  const from = state.openedAt;
  const to = now < from ? from : now;
  return { spans: [...state.spans, { from, to }], openedAt: null };
}

/**
 * Total live time in milliseconds, including the stretch still running.
 *
 * `now` is only used for the open span, so a stopped total is stable no matter
 * when it is asked.
 */
export function elapsedMs(state: ElapsedState, now: number): number {
  let total = 0;
  for (const span of state.spans) {
    const end = span.to ?? now;
    if (end > span.from) total += end - span.from;
  }
  if (state.openedAt !== null && now > state.openedAt) total += now - state.openedAt;
  return total;
}

/**
 * Total live time in whole seconds.
 *
 * Floored, not rounded: a clock that shows 00:01 before a second has passed is
 * claiming time that has not happened, and the report's duration should never
 * round a meeting up.
 */
export function elapsedSeconds(state: ElapsedState, now: number): number {
  return Math.floor(elapsedMs(state, now) / 1000);
}

/**
 * mm:ss, or h:mm:ss once there is an hour to show.
 *
 * Negative input reads as zero rather than as "-1:-1": the only way to get one
 * is a bug upstream, and a clock is the wrong place to discover it.
 */
export function formatElapsed(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
