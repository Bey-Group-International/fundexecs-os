// lib/meetings/admission-poll.ts
// How often a waiting guest asks whether they have been let in.
//
// Guests cannot use Realtime — they are unauthenticated, and the admissions
// table is readable only by org members — so the waiting screen polls. That poll
// is the one piece of the waiting room whose cost scales with how long people
// wait and how many of them there are, and a flat interval gets both ends of it
// wrong: too slow in the first seconds, when the host is looking straight at the
// notification and a guest is watching a spinner; and far too fast at four
// minutes, when nobody is coming.
//
// So the interval widens with the wait. The first stretch is tuned for the case
// that actually happens — a host who admits within a few seconds — and the later
// ones for the case that merely costs money.

/** Waited-for milliseconds → how long to wait before asking again. */
export interface PollStep {
  /** Applies once the guest has been waiting at least this long. */
  afterMs: number;
  everyMs: number;
}

/**
 * Ordered by `afterMs`. The first 20 seconds are the ones a guest experiences as
 * "is this thing working?", so they are the cheapest place to spend requests and
 * the most valuable: a host watching the panel admits in that window, and the
 * guest sees it within a second and a half rather than three.
 */
export const ADMISSION_POLL_SCHEDULE: readonly PollStep[] = [
  { afterMs: 0, everyMs: 1_500 },
  { afterMs: 20_000, everyMs: 3_000 },
  { afterMs: 60_000, everyMs: 6_000 },
  { afterMs: 180_000, everyMs: 10_000 },
];

/** How long to wait before the next poll, for a guest who has waited `waitedMs`. */
export function nextPollDelay(
  waitedMs: number,
  schedule: readonly PollStep[] = ADMISSION_POLL_SCHEDULE,
): number {
  let delay = schedule[0].everyMs;
  for (const step of schedule) {
    if (waitedMs >= step.afterMs) delay = step.everyMs;
    else break;
  }
  return delay;
}

/**
 * Whether to poll at all right now.
 *
 * A hidden tab is a guest who has gone to do something else. Their decision is
 * still waiting for them in the database when they come back — polling for it
 * every few seconds in a background tab buys nothing, and browsers throttle the
 * timers anyway, so the interval was never what it claimed to be there. Coming
 * back polls immediately, which makes the return *faster* than the flat interval
 * was: the answer is on screen as the tab focuses rather than up to a tick later.
 */
export function shouldPollNow(visibility: "visible" | "hidden" | undefined): boolean {
  return visibility !== "hidden";
}

/**
 * Requests saved over a wait of `waitedMs`, against a flat `flatMs` interval.
 * Used by the tests to state the trade rather than assert an opaque number.
 */
export function pollCount(waitedMs: number, schedule: readonly PollStep[] = ADMISSION_POLL_SCHEDULE): number {
  let t = 0;
  let n = 0;
  while (t < waitedMs) {
    t += nextPollDelay(t, schedule);
    n += 1;
  }
  return n;
}
