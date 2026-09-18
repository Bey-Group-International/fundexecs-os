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

/**
 * The cadence for a guest whose decision will be pushed to them.
 *
 * With a live broadcast subscription the poll is no longer how anyone finds out
 * they have been admitted — it is what catches the case where the push did not
 * arrive: a dropped socket, a proxy that eats WebSockets, a broadcast published
 * while the client was reconnecting. That is rare, so the interval is long; but
 * it is not zero, because a guest whose socket quietly died must still get in.
 *
 * A guest on this schedule who never receives a nudge waits at most 15 seconds
 * beyond the host's decision. One who receives it waits milliseconds.
 */
export const WATCHED_POLL_SCHEDULE: readonly PollStep[] = [
  { afterMs: 0, everyMs: 15_000 },
  { afterMs: 60_000, everyMs: 30_000 },
  { afterMs: 300_000, everyMs: 60_000 },
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

/**
 * How long to hold off after the server has refused us, by consecutive refusal.
 *
 * A 429 is the one answer that says what to do about itself, and the waiting
 * room used to treat it as no news: the guest kept asking on the fastest
 * cadence, which is what kept them refused. The last value repeats.
 *
 * Deliberately longer than the fast cadence it overrides, and deliberately
 * bounded — a refusal is temporary by construction, and a guest who backs off
 * past the window has paid for it twice.
 */
export const REFUSAL_BACKOFF_MS = [2_000, 6_000, 15_000, 30_000] as const;

/** The server's own answer, when it gave one. Seconds, as our limiter sends it. */
export function retryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  // A limiter can legitimately say 0 ("the window just turned"); treat that as
  // no useful guidance rather than as permission to ask again immediately.
  return seconds > 0 ? Math.min(seconds * 1000, 5 * 60_000) : null;
}

/**
 * How long to wait after a refusal.
 *
 * The server's `Retry-After` wins when it gave one — it knows when the window
 * actually turns, and the ladder is only a guess at it. The ladder is the floor
 * underneath, for a limiter that sent no header at all.
 */
export function refusalDelay(consecutive: number, serverMs?: number | null): number {
  const i = Math.min(Math.max(consecutive, 1), REFUSAL_BACKOFF_MS.length) - 1;
  const ours = REFUSAL_BACKOFF_MS[i];
  return serverMs && serverMs > 0 ? Math.max(serverMs, ours) : ours;
}

/**
 * What an answer from the knock or status endpoint means.
 *
 * Used for BOTH halves of the endpoint, because the guest's session has to read
 * them the same way. It did not: the poll had this function and the knock had
 * `if (!res.ok) return null` inline, which is how a knock the rate limiter
 * refused came to be indistinguishable from a knock nobody had answered yet.
 * The guest was shown "Waiting for the host to let you in" over a row that was
 * never inserted, and the poll's re-knock walked straight back into the same
 * 429. Nothing recovered, and the host's panel stayed empty.
 *
 * The three answers that are answers:
 *
 *  - **404** — the meeting is not there. It was deleted, or the room code never
 *    existed. Nothing about asking again can change that, and for a guest it is
 *    indistinguishable from the meeting having ended, which the session already
 *    knows how to act on.
 *  - **429** — the limiter, not the host. Temporary, so not a verdict; but the
 *    guest must not be told they are in a queue they are not in, and the asking
 *    must slow down. See refusalDelay.
 *  - **2xx** — whatever the body says.
 *
 * Everything else non-OK stays transient on purpose: a 500 is a bad minute
 * rather than a verdict, and treating it as terminal would turn a blip into a
 * guest told the meeting is over while it is still going on.
 */
export function admissionStatusFromResponse(
  httpStatus: number,
  body: { status?: string } | null,
): string | null {
  if (httpStatus === 404) return "ended";
  if (httpStatus === 429) return "busy";
  if (httpStatus < 200 || httpStatus > 299) return null;
  return body?.status ?? null;
}
