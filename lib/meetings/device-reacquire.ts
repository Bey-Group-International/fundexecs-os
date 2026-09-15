// lib/meetings/device-reacquire.ts
// Going back for a device the meeting started without.
//
// Joining is allowed to start without a camera or a microphone — openCallMedia
// walks the hardware, and if every candidate fails the member lands in the room
// with a message rather than with nothing. That is the right trade for getting
// in. It is the wrong place to stop.
//
// The overwhelmingly common failure is "in_use": the camera is still held by
// Zoom, or Teams, or the tab the member had this meeting open in a minute ago.
// That condition ends — usually within seconds, when the other application is
// quit or the other tab is closed — and nothing was watching for the moment it
// did. The member sat through a meeting on a black tile next to a button they
// did not know to press.
//
// So after the join, the room goes back for it. What that costs depends
// entirely on WHY the device could not be opened, which is what this module is
// for: two of the failures resolve on their own and are worth asking about
// again, one resolves only when the member acts and the browser will say so,
// and one cannot resolve at all by asking the same question.
//
// Pure: no getUserMedia, no timers, no navigator. The room supplies the failure
// and the clock, and acts on the answer.

import type { MediaFailure } from "./media-acquisition";

/**
 * How to wait for a device that would not open.
 *
 * The distinction that matters is who can change the answer. A device held by
 * another application becomes free without anybody touching this tab, so the
 * only way to find out is to ask again. A device behind a refused permission
 * becomes available only when the member changes it in the browser's own UI —
 * and asking again cannot prompt them, because a browser that has been told no
 * rejects the next call outright rather than re-prompting. Polling for that one
 * would be a loop that can never succeed.
 */
export type ReacquireWatch =
  /** Something else holds it, or the attempt was interrupted. Ask again. */
  | "poll"
  /** Only the member can change this, and the browser will tell us when they do. */
  | "permission"
  /** Asking the same question again gets the same answer. */
  | "never";

/**
 * What to do about a device that failed to open.
 *
 * `overconstrained` is the one that looks retryable and is not: the device is
 * present and working and simply cannot do what was asked of it, so the
 * identical request will fail identically for as long as the hardware is that
 * hardware. Going back for it would be a timer that runs for the whole meeting
 * and never once succeeds.
 *
 * `missing` polls rather than relying on the devicechange event alone. That
 * event is the better signal and the room listens for it too, but it is not
 * emitted reliably everywhere — some platforms miss a re-enumeration after a
 * dock is reconnected — and a device that has come back should not depend on
 * an event that may not arrive.
 */
export function watchFor(failure: MediaFailure): ReacquireWatch {
  switch (failure) {
    case "in_use":
    case "aborted":
    case "missing":
    case "unknown":
      return "poll";
    case "denied":
      return "permission";
    case "overconstrained":
      return "never";
  }
}

/**
 * The backoff, in milliseconds before each successive attempt.
 *
 * Front-loaded, because the case this exists for is measured in seconds: a
 * member who quits Zoom on being told their camera is busy does it while
 * looking at the message. Past the first half-minute the odds of catching the
 * release drop sharply and the cost of asking stops being worth it, so the
 * interval settles rather than continuing to climb — a meeting is long, and a
 * device freed forty minutes in should still be picked up.
 */
export const REACQUIRE_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000];

/** The interval once the front-loaded attempts are spent. */
export const REACQUIRE_SETTLED_MS = 60_000;

/**
 * When to stop asking altogether.
 *
 * Not because the device could not come back after this, but because a member
 * who has spent ten minutes in a meeting without their camera has made their
 * peace with it, and the button to start one is in front of them. An unbounded
 * timer on a call that runs all afternoon is a cost nobody asked for.
 */
export const REACQUIRE_GIVE_UP_MS = 10 * 60_000;

/**
 * How long to wait before the next attempt, or null to stop trying.
 *
 * `attempt` is how many have already been made, so the first call is 0.
 */
export function reacquireDelay(attempt: number, elapsedMs: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 0) return null;
  if (Number.isFinite(elapsedMs) && elapsedMs >= REACQUIRE_GIVE_UP_MS) return null;
  return REACQUIRE_DELAYS_MS[attempt] ?? REACQUIRE_SETTLED_MS;
}

/**
 * Whether an event from the environment should prompt an immediate attempt.
 *
 * Both events mean the world changed in a way that could make the same request
 * succeed, which is exactly the thing a backoff is bad at noticing: a member
 * who plugs a webcam in at second 3 should not wait out an interval that was
 * chosen on the assumption that nothing had happened.
 *
 * A permission change counts for a `poll` watch as well, not only for the
 * `permission` one. A member who grants the camera after being told it was
 * "in use" — the two go together more often than they should, because a device
 * held by another application reports differently across browsers — has made
 * the request worth repeating whatever we classified the first failure as.
 */
export function shouldTryNow(
  watch: ReacquireWatch,
  event: "devicechange" | "permissionchange",
): boolean {
  if (watch === "never") return false;
  if (event === "permissionchange") return true;
  return watch === "poll";
}
