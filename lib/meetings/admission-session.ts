// lib/meetings/admission-session.ts
// A guest's side of the waiting room, from knock to verdict.
//
// This is the sequence a guest's whole experience of the meeting hangs on, and
// it lived inside a 2,900-line component where the only way to exercise it was
// to stand up a WebRTC stack. Every bug in it — an admit that never arrived, a
// deny that a refresh undid, a poll that never stopped — reached the user as
// "the link didn't work" and reached nobody else at all.
//
// The rules it encodes, each of which has been wrong at least once:
//
//   - A knock that fails is a wait, not an error. The guest is shown the waiting
//     screen and the poll re-knocks for them; the alternative is a guest waiting
//     on a host who cannot see them.
//   - "unknown" from the server means no knock is on file. Waiting on a knock
//     that was never recorded is waiting forever, so re-knock.
//   - A decision is terminal and fires once. Nothing after it — a late poll
//     resolving, a visibility change — may fire a second callback.
//   - The timeout changes what the screen SAYS, and nothing else. Polling
//     continues, because a host who answers at three minutes should still get
//     their guest in.
//   - A hidden tab does not poll, and becoming visible polls at once. Browsers
//     throttle background timers anyway, so the interval was never what it
//     claimed to be there.
//   - A nudge is not a verdict. When the decision is pushed over Realtime the
//     session asks the server what actually happened; the push only says when
//     to ask. Anyone with the room code can publish on that channel, so a
//     payload that was believed would be a payload worth forging.
//   - Losing the push means going back to asking often. The safety-net cadence
//     is only safe while something is actually watching.
//   - Stopping means stopping: no timer, no listener, and no follow-through
//     from a request that was already in flight.
//
// Timers and visibility are read from the environment rather than injected, so
// tests drive it the way a browser does — fake timers and a real `document`.

import { WATCHED_POLL_SCHEDULE, nextPollDelay, shouldPollNow } from "./admission-poll";

/** How long before the screen admits the host has not answered. Polling goes on. */
export const ADMISSION_TIMEOUT_MS = 120_000;

/** What a live subscription tells the session. Both are advisory. */
export interface AdmissionWatchHandlers {
  /** The decision may have changed. Say nothing about what it is. */
  onNudge: () => void;
  /** Whether a push would currently reach us, which sets the polling cadence. */
  onConnectionChange: (connected: boolean) => void;
}

export interface AdmissionSessionOptions {
  /** POST the knock. Resolves to the server's status, or null if the request failed. */
  knock: () => Promise<string | null>;
  /** GET the current decision. Resolves to the status, or null if the request failed. */
  poll: () => Promise<string | null>;
  /**
   * Subscribe to this guest's decision being pushed. Returns an unsubscribe.
   *
   * Optional: without it the session polls on the responsive cadence exactly as
   * it did before, which is also what happens when the subscription never
   * connects. Realtime makes the answer immediate; it is not load-bearing.
   */
  watch?: (handlers: AdmissionWatchHandlers) => () => void;
  /** The host let them in. */
  onAdmitted: () => void | Promise<void>;
  /** The host turned them away. */
  onDenied: () => void;
  /** The meeting is over — it ended while they knocked, or before they did. */
  onEnded: () => void;
  /** They are on the waiting screen now; polling has begun. */
  onWaiting?: () => void;
  /** Long enough that the host is probably not coming. Copy only. */
  onTimedOut?: () => void;
  timeoutMs?: number;
}

export interface AdmissionSession {
  /** Knock, and begin polling if the answer is neither yes nor no. */
  start: () => Promise<void>;
  /** Stop everything. Idempotent, and safe to call from inside a callback. */
  stop: () => void;
}

/**
 * A guest's attempt to be let in, from the first knock to the verdict.
 *
 * Nothing happens until `start()`. After it, exactly one of `onAdmitted`,
 * `onDenied` or `onEnded` will fire — once — unless `stop()` gets there first;
 * `onWaiting` and `onTimedOut` are progress, not outcomes, and either may fire
 * before it. The session cleans itself up on a verdict, so a caller only has to
 * `stop()` when abandoning a wait that has not resolved.
 */
export function createAdmissionSession(opts: AdmissionSessionOptions): AdmissionSession {
  const timeoutMs = opts.timeoutMs ?? ADMISSION_TIMEOUT_MS;

  let stopped = false;
  let settled = false;
  let startedAt = 0;
  let watching = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let detachVisibility: (() => void) | null = null;
  let detachWatch: (() => void) | null = null;

  function stop() {
    stopped = true;
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
    if (timeoutTimer !== null) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    detachVisibility?.();
    detachVisibility = null;
    detachWatch?.();
    detachWatch = null;
  }

  /**
   * Act on a verdict, once. `settled` rather than `stopped` guards this: stop()
   * is also how an ordinary cancel ends the session, and that must not be
   * mistaken for a decision.
   */
  function settle(status: "admitted" | "denied" | "ended"): void {
    if (settled || stopped) return;
    settled = true;
    stop();
    if (status === "admitted") void opts.onAdmitted();
    else if (status === "denied") opts.onDenied();
    else opts.onEnded();
  }

  function isVerdict(status: string | null): status is "admitted" | "denied" | "ended" {
    return status === "admitted" || status === "denied" || status === "ended";
  }

  async function pollOnce(): Promise<void> {
    if (stopped || settled) return;
    if (!shouldPollNow(typeof document === "undefined" ? undefined : document.visibilityState)) return;

    let status: string | null = null;
    try {
      status = await opts.poll();
    } catch {
      return; // A failed poll is not news. Try again on the next tick.
    }
    // The session may have ended while this request was in the air.
    if (stopped || settled) return;

    if (isVerdict(status)) { settle(status); return; }
    if (status === "unknown") {
      // No knock on file — the POST lost its race, or the row is gone.
      try {
        const again = await opts.knock();
        if (!stopped && !settled && isVerdict(again)) settle(again);
      } catch { /* the next tick will try again */ }
    }
  }

  function scheduleNext(): void {
    if (stopped || settled) return;
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
    const schedule = watching ? WATCHED_POLL_SCHEDULE : undefined;
    pollTimer = setTimeout(() => {
      void pollOnce().then(() => { scheduleNext(); });
    }, nextPollDelay(Date.now() - startedAt, schedule));
  }

  /**
   * The push connected or dropped.
   *
   * Dropping reschedules rather than waiting out the pending timer: that timer
   * may be half a minute away, chosen on the assumption that something was
   * watching. Leaving it would make a guest pay for the disconnection with the
   * longest wait of the two cadences instead of the shortest.
   */
  function setWatching(connected: boolean): void {
    if (stopped || settled || watching === connected) return;
    watching = connected;
    if (pollTimer !== null) scheduleNext();
  }

  function beginWaiting(): void {
    if (stopped || settled) return;
    startedAt = Date.now();
    opts.onWaiting?.();

    timeoutTimer = setTimeout(() => {
      timeoutTimer = null;
      // Deliberately does NOT stop the poll: the wait is still live, and a host
      // who answers late still gets their guest in.
      if (!stopped && !settled) opts.onTimedOut?.();
    }, timeoutMs);

    // Subscribed before the first poll is scheduled, so a decision made while
    // the guest was still knocking is pushed rather than waited for.
    if (opts.watch) {
      detachWatch = opts.watch({
        onNudge: () => { void pollOnce(); },
        onConnectionChange: setWatching,
      });
    }

    scheduleNext();

    if (typeof document !== "undefined") {
      const onVisible = () => { if (document.visibilityState === "visible") void pollOnce(); };
      document.addEventListener("visibilitychange", onVisible);
      detachVisibility = () => document.removeEventListener("visibilitychange", onVisible);
    }
  }

  async function start(): Promise<void> {
    if (stopped || settled) return;
    let status: string | null = null;
    // A knock that never lands is a wait: the poll below re-knocks, which is a
    // better answer than an error screen for what is usually a dropped packet.
    try { status = await opts.knock(); } catch { status = null; }
    if (stopped || settled) return;
    if (isVerdict(status)) { settle(status); return; }
    beginWaiting();
  }

  return { start, stop };
}
