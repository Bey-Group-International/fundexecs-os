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
//   - Being admitted can still fail. Entering the room opens devices and builds
//     connections, and by then everything here has stopped; a failure nobody
//     catches is a guest stranded on the waiting screen while the host is told
//     they went in.
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
//   - Gaining it means asking once. A push reaches whoever is already
//     subscribed, so everything decided before that — including during the
//     knock the subscription follows — has to be asked for.
//   - Stopping means stopping: no timer, no listener, and no follow-through
//     from a request that was already in flight.
//
// Timers and visibility are read from the environment rather than injected, so
// tests drive it the way a browser does — fake timers and a real `document`.

import { WATCHED_POLL_SCHEDULE, nextPollDelay, refusalDelay, shouldPollNow } from "./admission-poll";

/** How long before the screen admits the host has not answered. Polling goes on. */
export const ADMISSION_TIMEOUT_MS = 120_000;

/**
 * How long a wait may actually run before the session stops asking.
 *
 * Three separate comments in this feature described a ten-minute bound, and
 * none of them was enforced anywhere: ADMISSION_TIMEOUT_MS changes the copy and
 * nothing else, and scheduleNext rescheduled unconditionally. So a waiting tab
 * left open kept asking an unauthenticated, service-role-backed endpoint every
 * ten seconds for as long as the tab lived — overnight, on a laptop nobody
 * closed.
 *
 * Ten minutes because that is the number the comments already claimed, and
 * because it is well past any wait a host is going to answer. Ending the wait
 * is not the same as refusing the guest: the screen offers to ask again, and
 * asking again costs one press.
 */
export const ADMISSION_MAX_WAIT_MS = 10 * 60_000;

/**
 * One answer from the knock or status endpoint.
 *
 * `status` is what `admissionStatusFromResponse` made of it — including "busy",
 * which is the limiter rather than the host. `retryAfterMs` is the server's own
 * `Retry-After` when it sent one; our limiter always does on a 429, and this
 * used to be sent and read by nobody.
 */
export interface AdmissionAnswer {
  status: string | null;
  retryAfterMs?: number | null;
}

/** What a live subscription tells the session. Both are advisory. */
export interface AdmissionWatchHandlers {
  /** The decision may have changed. Say nothing about what it is. */
  onNudge: () => void;
  /** Whether a push would currently reach us, which sets the polling cadence. */
  onConnectionChange: (connected: boolean) => void;
}

export interface AdmissionSessionOptions {
  /** POST the knock. Resolves to the server's answer; a null status is a failed request. */
  knock: () => Promise<AdmissionAnswer>;
  /** GET the current decision. Resolves to the server's answer. */
  poll: () => Promise<AdmissionAnswer>;
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
  /**
   * Being let in did not work.
   *
   * `onAdmitted` is the one callback that does real work — it opens devices,
   * negotiates ICE and joins a channel — and it is called after the session has
   * already torn itself down, because a decision is terminal. So a failure in
   * it used to vanish: the promise was discarded, every timer and listener was
   * already cleared, and the guest sat on "waiting for the host to let you in"
   * with nothing left running to change it. Not even the timed-out copy
   * appeared, because that timer had been cleared too — while the host saw them
   * admitted and gone from the panel.
   *
   * Optional, but the caller that does work in `onAdmitted` wants it.
   */
  onAdmitFailed?: (err: unknown) => void;
  /** The host turned them away. */
  onDenied: () => void;
  /** The meeting is over — it ended while they knocked, or before they did. */
  onEnded: () => void;
  /** They are on the waiting screen now; polling has begun. */
  onWaiting?: () => void;
  /** Long enough that the host is probably not coming. Copy only. */
  onTimedOut?: () => void;
  /**
   * The server is refusing us, or has stopped.
   *
   * True means the rate limiter turned a knock away, so this guest is NOT in a
   * queue however much the screen would like to say so. False means an answer
   * got through again. Advisory: the session keeps trying either way.
   */
  onBusy?: (busy: boolean) => void;
  /** The wait hit its bound and the session stopped asking. Terminal. */
  onGaveUp?: () => void;
  timeoutMs?: number;
  maxWaitMs?: number;
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
  const maxWaitMs = opts.maxWaitMs ?? ADMISSION_MAX_WAIT_MS;

  let stopped = false;
  let settled = false;
  let startedAt = 0;
  let watching = false;
  let busy = false;
  /** Consecutive refusals, which is what sets how long to hold off. */
  let refusals = 0;
  /** What the server said to wait, on the most recent refusal. */
  let serverRetryMs: number | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let giveUpTimer: ReturnType<typeof setTimeout> | null = null;
  let detachVisibility: (() => void) | null = null;
  let detachWatch: (() => void) | null = null;

  function stop() {
    stopped = true;
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
    if (timeoutTimer !== null) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    if (giveUpTimer !== null) { clearTimeout(giveUpTimer); giveUpTimer = null; }
    detachVisibility?.();
    detachVisibility = null;
    detachWatch?.();
    detachWatch = null;
  }

  /**
   * Record whether the server is turning us away, and say so once per change.
   *
   * The screen has to stop claiming this guest is in a queue: a refused knock
   * inserted no row, so the host has never heard of them. Reported on the edge
   * rather than per answer, because a guest held off for a minute would
   * otherwise get a callback every few seconds saying the same thing.
   */
  function setBusy(next: boolean, retryMs: number | null = null): void {
    if (next) { refusals += 1; serverRetryMs = retryMs; }
    else { refusals = 0; serverRetryMs = null; }
    if (busy === next) return;
    busy = next;
    opts.onBusy?.(next);
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
    if (status === "admitted") {
      // Wrapped rather than called bare so a synchronous throw is caught too,
      // and reported rather than discarded. See onAdmitFailed.
      void Promise.resolve()
        .then(() => opts.onAdmitted())
        .catch((err) => { opts.onAdmitFailed?.(err); });
    }
    else if (status === "denied") opts.onDenied();
    else opts.onEnded();
  }

  function isVerdict(status: string | null): status is "admitted" | "denied" | "ended" {
    return status === "admitted" || status === "denied" || status === "ended";
  }

  async function pollOnce(): Promise<void> {
    if (stopped || settled) return;
    if (!shouldPollNow(typeof document === "undefined" ? undefined : document.visibilityState)) return;

    let answer: AdmissionAnswer;
    try {
      answer = await opts.poll();
    } catch {
      return; // A failed poll is not news. Try again on the next tick.
    }
    // The session may have ended while this request was in the air.
    if (stopped || settled) return;

    if (answer.status === "busy") { setBusy(true, answer.retryAfterMs ?? null); return; }
    if (isVerdict(answer.status)) { settle(answer.status); return; }

    if (answer.status === "unknown") {
      // No knock on file — the POST lost its race, the row is gone, or the
      // first knock was refused and never inserted anything at all.
      try {
        const again = await opts.knock();
        if (stopped || settled) return;
        if (again.status === "busy") { setBusy(true, again.retryAfterMs ?? null); return; }
        setBusy(false);
        if (isVerdict(again.status)) settle(again.status);
      } catch { /* the next tick will try again */ }
      return;
    }

    // Anything else that came back at all means the server is answering us.
    if (answer.status !== null) setBusy(false);
  }

  function scheduleNext(): void {
    if (stopped || settled) return;
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
    const schedule = watching ? WATCHED_POLL_SCHEDULE : undefined;
    const cadence = nextPollDelay(Date.now() - startedAt, schedule);
    // A refusal overrides the cadence, never shortens it. Asking on the fastest
    // schedule is exactly what keeps a limited guest limited, and the limiter
    // had been telling us how long to hold off into a header nobody read.
    const delay = refusals > 0 ? Math.max(cadence, refusalDelay(refusals, serverRetryMs)) : cadence;
    pollTimer = setTimeout(() => {
      void pollOnce().then(() => { scheduleNext(); });
    }, delay);
  }

  /**
   * The push connected or dropped.
   *
   * Dropping reschedules rather than waiting out the pending timer: that timer
   * may be half a minute away, chosen on the assumption that something was
   * watching. Leaving it would make a guest pay for the disconnection with the
   * longest wait of the two cadences instead of the shortest.
   *
   * Connecting asks once, immediately, because a push is only delivered to
   * whoever is already listening. There is always a gap: the knock is recorded
   * on the server, and the subscription is only opened once its response has
   * travelled back and the socket has joined the channel. A host watching the
   * panel — the case the whole responsive cadence exists for — clicks Admit
   * inside that gap, and the nudge is published to a channel nobody is on.
   * Without this the guest then sits on the *watched* cadence, so being admitted
   * instantly would have meant waiting fifteen seconds to hear about it.
   *
   * The same applies to every reconnect after a drop: nudges published while the
   * socket was down reached nobody, and only asking finds out.
   */
  function setWatching(connected: boolean): void {
    if (stopped || settled || watching === connected) return;
    watching = connected;
    if (connected) void pollOnce();
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

    // ...but the wait does end eventually. This is the bound three comments in
    // this feature described and none of them enforced — see
    // ADMISSION_MAX_WAIT_MS. Not a verdict: nobody decided anything, so this
    // does not settle. The screen offers to ask again.
    giveUpTimer = setTimeout(() => {
      giveUpTimer = null;
      if (stopped || settled) return;
      stop();
      opts.onGaveUp?.();
    }, maxWaitMs);

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
    let answer: AdmissionAnswer = { status: null };
    // A knock that never lands is a wait: the poll below re-knocks, which is a
    // better answer than an error screen for what is usually a dropped packet.
    try { answer = await opts.knock(); } catch { answer = { status: null }; }
    if (stopped || settled) return;

    // A REFUSED knock is different in kind from a dropped one, and conflating
    // them is what put a guest on "waiting for the host" over a row that was
    // never inserted. The wait still begins — the refusal is temporary and the
    // poll's re-knock is what gets them in — but the screen is told the truth
    // about it, and the asking starts at the backoff rather than at 1.5s.
    if (answer.status === "busy") {
      setBusy(true, answer.retryAfterMs ?? null);
      beginWaiting();
      return;
    }
    if (isVerdict(answer.status)) { settle(answer.status); return; }
    beginWaiting();
  }

  return { start, stop };
}
