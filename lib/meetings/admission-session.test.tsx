/**
 * The guest's side of the waiting room, driven end to end.
 *
 * A .tsx file so it runs in the jsdom project: this orchestration reads
 * `document.visibilityState` and listens for `visibilitychange`, and mocking
 * those away would test something other than what ships.
 *
 * Fake timers throughout, so a two-minute wait costs no wall-clock and the poll
 * cadence can be asserted exactly rather than approximately.
 */
import { ADMISSION_MAX_WAIT_MS, ADMISSION_TIMEOUT_MS, createAdmissionSession } from "./admission-session";
import { REFUSAL_BACKOFF_MS } from "./admission-poll";

/** Put the tab in a visibility state and fire the event the browser would. */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Callbacks plus queued knock/poll answers, so each test states only its own sequence. */
function harness(opts: { knock?: (string | null)[]; poll?: (string | null)[] } = {}) {
  const knockAnswers = [...(opts.knock ?? ["waiting"])];
  const pollAnswers = [...(opts.poll ?? [])];
  const calls = { knock: 0, poll: 0 };

  const cb = {
    onAdmitted: jest.fn(),
    onDenied: jest.fn(),
    onEnded: jest.fn(),
    onWaiting: jest.fn(),
    onTimedOut: jest.fn(),
    onBusy: jest.fn(),
    onGaveUp: jest.fn(),
  };

  const session = createAdmissionSession({
    ...cb,
    // The queues stay plain strings — a test states a sequence of answers, not a
    // sequence of HTTP responses — and are wrapped in the shape the session now
    // takes. `retryAfterMs` is left out: absent is what a server that sent no
    // Retry-After looks like, and the backoff ladder has to work without one.
    knock: async () => { calls.knock += 1; return { status: knockAnswers.length > 1 ? knockAnswers.shift()! : knockAnswers[0] ?? "waiting" }; },
    poll: async () => { calls.poll += 1; return { status: pollAnswers.length > 1 ? pollAnswers.shift()! : pollAnswers[0] ?? "waiting" }; },
  });

  return { session, calls, ...cb };
}

/**
 * A stand-in for the Realtime subscription, driven by the test.
 *
 * `connected` defaults to true because that is the case worth exercising: the
 * session should then be nearly silent until nudged.
 */
function watcher({ connected = true }: { connected?: boolean } = {}) {
  const state: {
    nudge: () => void;
    setConnected: (c: boolean) => void;
    detached: boolean;
    subscribes: number;
  } = { nudge: () => {}, setConnected: () => {}, detached: false, subscribes: 0 };

  const watch = (h: { onNudge: () => void; onConnectionChange: (c: boolean) => void }) => {
    state.subscribes += 1;
    state.nudge = h.onNudge;
    state.setConnected = h.onConnectionChange;
    if (connected) h.onConnectionChange(true);
    return () => { state.detached = true; };
  };

  return { watch, state };
}

/** Let queued microtasks run — one tick is timer → poll() → knock()? → schedule. */
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/**
 * Advance fake timers in slices, flushing between.
 *
 * One big `advanceTimersByTime` would not do: this is a timeout CHAIN, and the
 * next timer is only scheduled once the current poll's promise resolves. Jumping
 * the whole span fires the one timer that exists and then finds nothing more to
 * run, so the chain appears to stop after a single tick. Stepping lets each link
 * be created before the clock reaches it.
 */
async function advance(ms: number) {
  const STEP = 250;
  let left = ms;
  await flush();
  while (left > 0) {
    const slice = Math.min(STEP, left);
    jest.advanceTimersByTime(slice);
    left -= slice;
    await flush();
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  setVisibility("visible");
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("the knock", () => {
  it("enters straight away when the host has already admitted this guest", async () => {
    const h = harness({ knock: ["admitted"] });
    await h.session.start();
    expect(h.onAdmitted).toHaveBeenCalledTimes(1);
    expect(h.onWaiting).not.toHaveBeenCalled();

    // No polling: there is nothing left to ask about.
    await advance(60_000);
    expect(h.calls.poll).toBe(0);
  });

  it("stops on a deny without ever showing the waiting screen", async () => {
    const h = harness({ knock: ["denied"] });
    await h.session.start();
    expect(h.onDenied).toHaveBeenCalledTimes(1);
    expect(h.onWaiting).not.toHaveBeenCalled();
    await advance(60_000);
    expect(h.calls.poll).toBe(0);
  });

  it("reports an already-finished meeting", async () => {
    const h = harness({ knock: ["ended"] });
    await h.session.start();
    expect(h.onEnded).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(h.calls.poll).toBe(0);
  });

  it("waits, and starts polling, when the host has not decided", async () => {
    const h = harness({ knock: ["waiting"] });
    await h.session.start();
    expect(h.onWaiting).toHaveBeenCalledTimes(1);
    await advance(1_500);
    expect(h.calls.poll).toBe(1);
  });

  // A dropped knock used to leave the guest on a waiting screen with no row on
  // the server — waiting on a host who could not see them.
  it("treats a failed knock as a wait, and the poll repairs it", async () => {
    const h = harness({ knock: [null, "waiting"], poll: ["unknown", "waiting"] });
    await h.session.start();
    expect(h.onWaiting).toHaveBeenCalledTimes(1);
    expect(h.calls.knock).toBe(1);

    await advance(1_500);
    expect(h.calls.knock).toBe(2); // re-knocked on "unknown"
  });

  it("treats a thrown knock as a wait rather than an error screen", async () => {
    const cb = { onAdmitted: jest.fn(), onDenied: jest.fn(), onEnded: jest.fn(), onWaiting: jest.fn() };
    const session = createAdmissionSession({
      ...cb,
      knock: async () => { throw new Error("offline"); },
      poll: async () => ({ status: "waiting" }),
    });
    await session.start();
    expect(cb.onWaiting).toHaveBeenCalledTimes(1);
    session.stop();
  });
});

describe("the poll", () => {
  it("lets the guest in when the host admits", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting", "admitted"] });
    await h.session.start();
    await advance(1_500);
    expect(h.onAdmitted).not.toHaveBeenCalled();
    await advance(1_500);
    expect(h.onAdmitted).toHaveBeenCalledTimes(1);
  });

  it("turns the guest away when the host denies", async () => {
    const h = harness({ knock: ["waiting"], poll: ["denied"] });
    await h.session.start();
    await advance(1_500);
    expect(h.onDenied).toHaveBeenCalledTimes(1);
  });

  it("reports the meeting ending underneath a waiting guest", async () => {
    const h = harness({ knock: ["waiting"], poll: ["ended"] });
    await h.session.start();
    await advance(1_500);
    expect(h.onEnded).toHaveBeenCalledTimes(1);
  });

  it("stops asking once there is a verdict", async () => {
    const h = harness({ knock: ["waiting"], poll: ["admitted"] });
    await h.session.start();
    await advance(1_500);
    const after = h.calls.poll;
    await advance(60_000);
    expect(h.calls.poll).toBe(after);
  });

  // "unknown" means the server has no knock for this key.
  it("re-knocks when the server has no knock on file, and keeps waiting", async () => {
    const h = harness({ knock: ["waiting"], poll: ["unknown", "waiting"] });
    await h.session.start();
    expect(h.calls.knock).toBe(1);
    await advance(1_500);
    expect(h.calls.knock).toBe(2);
    expect(h.onAdmitted).not.toHaveBeenCalled();
    expect(h.onDenied).not.toHaveBeenCalled();
  });

  it("acts on a verdict that the re-knock itself returns", async () => {
    const h = harness({ knock: ["waiting", "admitted"], poll: ["unknown"] });
    await h.session.start();
    await advance(1_500);
    expect(h.onAdmitted).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting through a failed poll", async () => {
    const h = harness({ knock: ["waiting"], poll: [null, "waiting"] });
    await h.session.start();
    await advance(1_500);
    expect(h.onDenied).not.toHaveBeenCalled();
    expect(h.onEnded).not.toHaveBeenCalled();
    await advance(3_000);
    expect(h.calls.poll).toBeGreaterThan(1);
  });

  it("keeps waiting through a thrown poll", async () => {
    const cb = { onAdmitted: jest.fn(), onDenied: jest.fn(), onEnded: jest.fn() };
    let polls = 0;
    const session = createAdmissionSession({
      ...cb,
      knock: async () => ({ status: "waiting" }),
      poll: async () => { polls += 1; throw new Error("offline"); },
    });
    await session.start();
    await advance(1_500);
    await advance(1_500);
    expect(polls).toBeGreaterThan(1);
    expect(cb.onDenied).not.toHaveBeenCalled();
    session.stop();
  });

  it("never fires a second decision", async () => {
    const h = harness({ knock: ["waiting"], poll: ["admitted"] });
    await h.session.start();
    await advance(1_500);
    await advance(60_000);
    const total = h.onAdmitted.mock.calls.length + h.onDenied.mock.calls.length + h.onEnded.mock.calls.length;
    expect(total).toBe(1);
  });
});

describe("the cadence", () => {
  it("asks first after the schedule's opening interval, not immediately", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    expect(h.calls.poll).toBe(0);
    await advance(1_499);
    expect(h.calls.poll).toBe(0);
    await advance(1);
    expect(h.calls.poll).toBe(1);
  });

  it("widens as the wait goes on", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();

    // First 20s at 1.5s.
    await advance(20_000);
    const early = h.calls.poll;
    expect(early).toBeGreaterThanOrEqual(12);

    // The next 20s are at 3s, so roughly half as many.
    await advance(20_000);
    const later = h.calls.poll - early;
    expect(later).toBeLessThan(early);
  });

  // The whole point of a chain over setInterval: a slow network must not stack
  // requests on a guest who is already having a bad time.
  it("never has two requests in flight at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    // A holder object, not a bare `let`: TypeScript narrows a local assigned
    // only inside a callback to `never` at the call site.
    const hang: { release?: () => void } = {};
    const session = createAdmissionSession({
      onAdmitted: jest.fn(), onDenied: jest.fn(), onEnded: jest.fn(),
      knock: async () => ({ status: "waiting" }),
      poll: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((r) => { hang.release = r; });
        inFlight -= 1;
        return { status: "waiting" };
      },
    });
    await session.start();

    await advance(1_500);          // first poll starts, and hangs
    await advance(10_000);         // the clock runs on while it hangs
    expect(maxInFlight).toBe(1);

    hang.release?.();
    await advance(0);
    expect(maxInFlight).toBe(1);
    session.stop();
  });
});

describe("a tab nobody is looking at", () => {
  it("does not poll while hidden", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    setVisibility("hidden");
    await advance(30_000);
    expect(h.calls.poll).toBe(0);
  });

  // Coming back is FASTER than the flat interval was: the answer is on screen as
  // the tab focuses rather than up to a tick later.
  it("asks the moment the guest comes back", async () => {
    const h = harness({ knock: ["waiting"], poll: ["admitted"] });
    await h.session.start();
    setVisibility("hidden");
    await advance(30_000);
    expect(h.calls.poll).toBe(0);

    setVisibility("visible");
    await flush();
    expect(h.calls.poll).toBe(1);
    expect(h.onAdmitted).toHaveBeenCalledTimes(1);
  });

  it("resumes its ordinary cadence after coming back", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    setVisibility("hidden");
    await advance(10_000);
    setVisibility("visible");
    await advance(10_000);
    expect(h.calls.poll).toBeGreaterThan(1);
  });
});

describe("the two-minute mark", () => {
  it("says the host has not responded", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    await advance(ADMISSION_TIMEOUT_MS - 1);
    expect(h.onTimedOut).not.toHaveBeenCalled();
    await advance(1);
    expect(h.onTimedOut).toHaveBeenCalledTimes(1);
  });

  // The timeout is copy, not a stop. A host answering at three minutes still
  // gets their guest in.
  it("keeps polling afterwards, so a late host still gets the guest in", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    await advance(ADMISSION_TIMEOUT_MS);
    const atTimeout = h.calls.poll;

    await advance(60_000);
    expect(h.calls.poll).toBeGreaterThan(atTimeout);
  });

  it("still admits a guest after the timeout has shown", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    await advance(ADMISSION_TIMEOUT_MS);
    expect(h.onTimedOut).toHaveBeenCalled();

    h.session.stop();
    const late = harness({ knock: ["waiting"], poll: ["admitted"] });
    await late.session.start();
    await advance(1_500);
    expect(late.onAdmitted).toHaveBeenCalledTimes(1);
  });

  it("does not announce the timeout to a guest who already left", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    h.session.stop();
    await advance(ADMISSION_TIMEOUT_MS + 1_000);
    expect(h.onTimedOut).not.toHaveBeenCalled();
  });
});

describe("stopping", () => {
  // The bug this guards: Cancel stopped the timers but the guest stayed on the
  // waiting screen. Stopping has to mean stopping.
  it("asks nothing more once stopped", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    await advance(1_500);
    const atStop = h.calls.poll;

    h.session.stop();
    await advance(60_000);
    expect(h.calls.poll).toBe(atStop);
  });

  it("fires no decision from a request already in flight when it stopped", async () => {
    const hang: { release?: () => void } = {};
    const cb = { onAdmitted: jest.fn(), onDenied: jest.fn(), onEnded: jest.fn() };
    const session = createAdmissionSession({
      ...cb,
      knock: async () => ({ status: "waiting" }),
      poll: async () => {
        await new Promise<void>((r) => { hang.release = r; });
        return { status: "admitted" };
      },
    });
    await session.start();
    await advance(1_500);   // the poll is now in flight

    session.stop();
    hang.release?.();
    await flush();
    expect(cb.onAdmitted).not.toHaveBeenCalled();
  });

  // `settle` refuses to fire twice on its own, so the guard after the awaited
  // poll earns its keep somewhere else: a poll that comes back "unknown" would
  // otherwise send a fresh knock POST on behalf of a guest who has gone.
  it("does not re-knock for a guest who has already left", async () => {
    const hang: { release?: () => void } = {};
    let knocks = 0;
    const session = createAdmissionSession({
      onAdmitted: jest.fn(), onDenied: jest.fn(), onEnded: jest.fn(),
      knock: async () => { knocks += 1; return { status: "waiting" }; },
      poll: async () => {
        await new Promise<void>((r) => { hang.release = r; });
        return { status: "unknown" };
      },
    });
    await session.start();
    expect(knocks).toBe(1);

    await advance(1_500);   // the poll is in flight
    session.stop();
    hang.release?.();       // ...and comes back "unknown" after the guest left
    await flush();

    expect(knocks).toBe(1);
  });

  it("stops listening for the tab coming back", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    h.session.stop();

    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(h.calls.poll).toBe(0);
  });

  it("can be stopped twice", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    await h.session.start();
    h.session.stop();
    expect(() => h.session.stop()).not.toThrow();
  });

  it("does nothing when started after being stopped", async () => {
    const h = harness({ knock: ["waiting"], poll: ["waiting"] });
    h.session.stop();
    await h.session.start();
    expect(h.calls.knock).toBe(0);
    expect(h.onWaiting).not.toHaveBeenCalled();
  });

  // A verdict stops the session itself; a later cancel must not undo it or
  // double-fire anything.
  it("tolerates a stop after a verdict", async () => {
    const h = harness({ knock: ["admitted"] });
    await h.session.start();
    h.session.stop();
    expect(h.onAdmitted).toHaveBeenCalledTimes(1);
  });
});

describe("being let in, and not getting in", () => {
  /** A session whose onAdmitted fails the way entering a room can. */
  function failing(reason: "throws" | "rejects") {
    const onAdmitFailed = jest.fn();
    const session = createAdmissionSession({
      knock: async () => ({ status: "admitted" }),
      poll: async () => ({ status: "admitted" }),
      onAdmitted: reason === "throws"
        ? () => { throw new Error("getUserMedia exploded"); }
        : async () => { throw new Error("ICE never came back"); },
      onDenied: jest.fn(),
      onEnded: jest.fn(),
      onAdmitFailed,
    });
    return { session, onAdmitFailed };
  }

  // The failure used to vanish: the promise was discarded, and every timer and
  // listener had already been cleared because a decision is terminal. The guest
  // sat on "waiting for the host to let you in" with nothing left running to
  // change it — while the host saw them admitted and gone from the panel.
  it("reports a rejected entry rather than discarding it", async () => {
    const h = failing("rejects");
    await h.session.start();
    await flush();
    expect(h.onAdmitFailed).toHaveBeenCalledTimes(1);
    expect(h.onAdmitFailed.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  // Opening a device can throw before it ever returns a promise.
  it("catches a synchronous throw too", async () => {
    const h = failing("throws");
    await h.session.start();
    await flush();
    expect(h.onAdmitFailed).toHaveBeenCalledTimes(1);
  });

  it("says nothing when entering the room works", async () => {
    const onAdmitFailed = jest.fn();
    const onAdmitted = jest.fn(async () => {});
    const session = createAdmissionSession({
      knock: async () => ({ status: "admitted" }),
      poll: async () => ({ status: "admitted" }),
      onAdmitted, onDenied: jest.fn(), onEnded: jest.fn(), onAdmitFailed,
    });
    await session.start();
    await flush();
    expect(onAdmitted).toHaveBeenCalledTimes(1);
    expect(onAdmitFailed).not.toHaveBeenCalled();
  });

  // The callback is optional, and a caller that does not pass one must not be
  // handed an unhandled rejection instead.
  it("survives a caller that does not want to know", async () => {
    const session = createAdmissionSession({
      knock: async () => ({ status: "admitted" }),
      poll: async () => ({ status: "admitted" }),
      onAdmitted: async () => { throw new Error("nope"); },
      onDenied: jest.fn(), onEnded: jest.fn(),
    });
    await expect(session.start()).resolves.toBeUndefined();
    await flush();
  });

  // A failure is not a second verdict. Nothing may start polling again behind
  // it, or the guest is admitted twice.
  it("stays settled after the failure", async () => {
    const calls = { poll: 0 };
    const onAdmitFailed = jest.fn();
    const session = createAdmissionSession({
      knock: async () => ({ status: "admitted" }),
      poll: async () => { calls.poll += 1; return { status: "admitted" }; },
      onAdmitted: async () => { throw new Error("no"); },
      onDenied: jest.fn(), onEnded: jest.fn(), onAdmitFailed,
    });
    await session.start();
    await advance(60_000);
    expect(onAdmitFailed).toHaveBeenCalledTimes(1);
    expect(calls.poll).toBe(0);
  });
});

describe("a decision pushed over Realtime", () => {
  /** A session with a watcher attached, sharing the harness's answer queues. */
  function watched(opts: { knock?: (string | null)[]; poll?: (string | null)[]; connected?: boolean } = {}) {
    const knockAnswers = [...(opts.knock ?? ["waiting"])];
    const pollAnswers = [...(opts.poll ?? ["waiting"])];
    const calls = { knock: 0, poll: 0 };
    const cb = {
      onAdmitted: jest.fn(), onDenied: jest.fn(), onEnded: jest.fn(),
      onWaiting: jest.fn(), onTimedOut: jest.fn(),
    };
    const w = watcher({ connected: opts.connected });
    const session = createAdmissionSession({
      ...cb,
      watch: w.watch,
      knock: async () => { calls.knock += 1; return { status: knockAnswers.length > 1 ? knockAnswers.shift()! : knockAnswers[0] ?? "waiting" }; },
      poll: async () => { calls.poll += 1; return { status: pollAnswers.length > 1 ? pollAnswers.shift()! : pollAnswers[0] ?? "waiting" }; },
    });
    return { session, calls, watcher: w.state, ...cb };
  }

  it("subscribes as soon as the guest starts waiting", async () => {
    const h = watched();
    expect(h.watcher.subscribes).toBe(0);
    await h.session.start();
    expect(h.watcher.subscribes).toBe(1);
    h.session.stop();
  });

  it("does not subscribe for a guest the host has already decided about", async () => {
    const h = watched({ knock: ["admitted"] });
    await h.session.start();
    expect(h.watcher.subscribes).toBe(0);
  });

  // The nudge says "ask", never "you are in": anyone with the room code can
  // publish on that channel, so a payload that was believed would be worth
  // forging. The verdict always comes from the server.
  it("asks the server what happened rather than believing the nudge", async () => {
    // The first answer is spent on the catch-up ask that connecting performs, so
    // the second is the one the nudge goes and gets.
    const h = watched({ poll: ["waiting", "admitted"] });
    await h.session.start();
    await flush();
    const beforeNudge = h.calls.poll;
    expect(h.onAdmitted).not.toHaveBeenCalled();

    h.watcher.nudge();
    await flush();
    expect(h.calls.poll).toBe(beforeNudge + 1);
    expect(h.onAdmitted).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when a nudge turns out to mean nothing", async () => {
    const h = watched({ poll: ["waiting"] });
    await h.session.start();
    h.watcher.nudge();
    await flush();
    expect(h.onAdmitted).not.toHaveBeenCalled();
    expect(h.onDenied).not.toHaveBeenCalled();
    h.session.stop();
  });

  it("carries a deny as readily as an admit", async () => {
    const h = watched({ poll: ["waiting", "denied"] });
    await h.session.start();
    await flush();
    h.watcher.nudge();
    await flush();
    expect(h.onDenied).toHaveBeenCalledTimes(1);
  });

  // A push only reaches whoever is already listening, and the guest is not
  // listening until the knock's response has come back and the socket has joined
  // the channel. A host watching the panel admits inside that gap.
  it("finds a decision made before it was listening, without waiting for a tick", async () => {
    const h = watched({ poll: ["admitted"] });
    await h.session.start();
    await flush();

    // No timer has advanced: this can only have come from the ask that
    // connecting performs. Before it did, the first watched poll was fifteen
    // seconds away — the whole of an instant admission spent on a spinner.
    expect(h.onAdmitted).toHaveBeenCalledTimes(1);
    expect(h.calls.poll).toBe(1);
  });

  it("catches up on a nudge published while the socket was down", async () => {
    const calls = { poll: 0 };
    let status = "waiting";
    const w = watcher({ connected: true });
    const onAdmitted = jest.fn();
    const session = createAdmissionSession({
      onAdmitted, onDenied: jest.fn(), onEnded: jest.fn(),
      watch: w.watch,
      knock: async () => ({ status: "waiting" }),
      poll: async () => { calls.poll += 1; return { status }; },
    });
    await session.start();
    await flush();

    w.state.setConnected(false);
    // Decided while nothing was subscribed, so the nudge reached no one and
    // nothing is coming to say so.
    status = "admitted";
    await flush();
    expect(onAdmitted).not.toHaveBeenCalled();

    w.state.setConnected(true);
    await flush();
    expect(onAdmitted).toHaveBeenCalledTimes(1);
    session.stop();
  });

  // The control: asking on connect is what connecting costs, so a subscription
  // that never connects must not pay it. This guest is on the responsive cadence
  // precisely because nothing is watching for them.
  it("does not ask on connect when there is no connection to make", async () => {
    const h = watched({ connected: false, poll: ["admitted"] });
    await h.session.start();
    await flush();
    expect(h.calls.poll).toBe(0);
    h.session.stop();
  });

  it("unsubscribes when the guest leaves", async () => {
    const h = watched();
    await h.session.start();
    expect(h.watcher.detached).toBe(false);
    h.session.stop();
    expect(h.watcher.detached).toBe(true);
  });

  it("unsubscribes once a verdict arrives", async () => {
    const h = watched({ poll: ["waiting", "admitted"] });
    await h.session.start();
    await flush();
    expect(h.watcher.detached).toBe(false);
    h.watcher.nudge();
    await flush();
    expect(h.watcher.detached).toBe(true);
  });

  it("ignores a nudge that arrives after the guest left", async () => {
    const h = watched({ poll: ["waiting"] });
    await h.session.start();
    await flush();
    const asked = h.calls.poll;
    h.session.stop();

    h.watcher.nudge();
    await flush();
    expect(h.calls.poll).toBe(asked);
    expect(h.onAdmitted).not.toHaveBeenCalled();
  });
});

describe("the cadence while something is watching", () => {
  function watched(connected: boolean) {
    const calls = { poll: 0 };
    const w = watcher({ connected });
    const session = createAdmissionSession({
      onAdmitted: jest.fn(), onDenied: jest.fn(), onEnded: jest.fn(),
      watch: w.watch,
      knock: async () => ({ status: "waiting" }),
      poll: async () => { calls.poll += 1; return { status: "waiting" }; },
    });
    return { session, calls, watcher: w.state };
  }

  // The point of the push: a connected guest should barely talk to the server.
  it("all but stops polling once connected", async () => {
    const h = watched(true);
    await h.session.start();
    await advance(20_000);
    expect(h.calls.poll).toBeLessThanOrEqual(2);
    h.session.stop();
  });

  it("polls on the responsive cadence when the subscription never connects", async () => {
    const h = watched(false);
    await h.session.start();
    await advance(20_000);
    expect(h.calls.poll).toBeGreaterThanOrEqual(12);
    h.session.stop();
  });

  // A socket that dies quietly is what this safety net exists for. Waiting out a
  // timer chosen for the connected cadence would make the guest pay for the
  // disconnection with the longest wait rather than the shortest.
  it("goes back to asking often the moment the connection drops", async () => {
    const h = watched(true);
    await h.session.start();
    await advance(5_000);
    const whileConnected = h.calls.poll;

    h.watcher.setConnected(false);
    await advance(10_000);
    expect(h.calls.poll - whileConnected).toBeGreaterThanOrEqual(5);
    h.session.stop();
  });

  it("quietens again when the connection comes back", async () => {
    const h = watched(false);
    await h.session.start();
    await advance(10_000);
    const busy = h.calls.poll;

    h.watcher.setConnected(true);
    await advance(10_000);
    expect(h.calls.poll - busy).toBeLessThan(busy);
    h.session.stop();
  });

  it("still admits a connected guest whose nudge never arrives", async () => {
    const calls = { poll: 0 };
    const w = watcher({ connected: true });
    const onAdmitted = jest.fn();
    const session = createAdmissionSession({
      onAdmitted, onDenied: jest.fn(), onEnded: jest.fn(),
      watch: w.watch,
      knock: async () => ({ status: "waiting" }),
      poll: async () => { calls.poll += 1; return { status: calls.poll > 1 ? "admitted" : "waiting" }; },
    });
    await session.start();

    // No nudge is ever fired: the safety net has to carry this on its own.
    await advance(45_000);
    expect(onAdmitted).toHaveBeenCalledTimes(1);
    session.stop();
  });
});

// ── A knock the server refused is not a queue ───────────────────────────────
//
// `if (!res.ok) return null` at the call site made a 429 — no row inserted, the
// host never told — indistinguishable from a knock that simply had no answer
// yet. The guest was shown "Waiting for the host to let you in" over a queue
// they were not in, and the poll's re-knock walked into the same refusal
// forever. Nothing recovered and the host's panel stayed empty.

describe("a knock the server refused", () => {
  it("says so rather than claiming the host has been told", async () => {
    const h = harness({ knock: ["busy"] });
    await h.session.start();

    expect(h.onBusy).toHaveBeenCalledWith(true);
    // Still waiting — the refusal is temporary and the re-knock is what gets
    // them in — but the screen is told which kind of waiting this is.
    expect(h.onWaiting).toHaveBeenCalledTimes(1);
    expect(h.onAdmitted).not.toHaveBeenCalled();
    h.session.stop();
  });

  it("is never mistaken for a verdict", async () => {
    const h = harness({ knock: ["busy"], poll: ["busy"] });
    await h.session.start();
    await advance(60_000);

    expect(h.onAdmitted).not.toHaveBeenCalled();
    expect(h.onDenied).not.toHaveBeenCalled();
    expect(h.onEnded).not.toHaveBeenCalled();
    h.session.stop();
  });

  // The fix's other half. Asking on the fastest cadence is what keeps a
  // refused guest refused, so a refusal has to slow the asking down.
  it("stops asking on the fastest cadence", async () => {
    const h = harness({ knock: ["busy"], poll: ["busy"] });
    await h.session.start();
    const after = h.calls.poll;

    // The first backoff step is longer than the 1.5s cadence, so a window
    // shorter than it must produce no poll at all.
    await advance(REFUSAL_BACKOFF_MS[0] - 500);
    expect(h.calls.poll).toBe(after);

    await advance(1_000);
    expect(h.calls.poll).toBeGreaterThan(after);
    h.session.stop();
  });

  it("goes back to the ordinary waiting copy once an answer gets through", async () => {
    const h = harness({ knock: ["busy", "waiting"], poll: ["unknown", "waiting"] });
    await h.session.start();
    expect(h.onBusy).toHaveBeenLastCalledWith(true);

    // The poll finds no row (nothing was ever inserted), re-knocks, and this
    // time the knock lands.
    await advance(30_000);
    expect(h.onBusy).toHaveBeenLastCalledWith(false);
    h.session.stop();
  });

  // Reported on the edge: a guest held off for a minute should not get a
  // callback every few seconds saying the same thing.
  it("reports the refusal once, not once per attempt", async () => {
    const h = harness({ knock: ["busy"], poll: ["busy"] });
    await h.session.start();
    await advance(120_000);
    expect(h.onBusy.mock.calls.filter((c) => c[0] === true)).toHaveLength(1);
    h.session.stop();
  });

  it("still takes a real verdict that arrives after a refusal", async () => {
    const h = harness({ knock: ["busy"], poll: ["busy", "admitted"] });
    await h.session.start();
    await advance(60_000);
    expect(h.onAdmitted).toHaveBeenCalledTimes(1);
    h.session.stop();
  });
});

// ── The wait has an end ─────────────────────────────────────────────────────
//
// Three comments in this feature described a ten-minute bound and none of them
// enforced it: the two-minute timeout is copy only, and scheduleNext
// rescheduled unconditionally. A waiting tab left open asked an
// unauthenticated endpoint every ten seconds for as long as it lived.

describe("the end of a wait", () => {
  it("keeps asking right up to the bound", async () => {
    const h = harness();
    await h.session.start();
    await advance(ADMISSION_MAX_WAIT_MS - 30_000);

    expect(h.onGaveUp).not.toHaveBeenCalled();
    expect(h.calls.poll).toBeGreaterThan(0);
    h.session.stop();
  });

  it("stops asking once it is past", async () => {
    const h = harness();
    await h.session.start();
    await advance(ADMISSION_MAX_WAIT_MS + 5_000);
    expect(h.onGaveUp).toHaveBeenCalledTimes(1);

    const after = h.calls.poll;
    await advance(120_000);
    expect(h.calls.poll).toBe(after);
  });

  // Nobody decided anything, so this is not a verdict and must not be reported
  // as one — the screen offers to ask again rather than saying they were
  // turned away.
  it("is not a verdict", async () => {
    const h = harness();
    await h.session.start();
    await advance(ADMISSION_MAX_WAIT_MS + 5_000);

    expect(h.onDenied).not.toHaveBeenCalled();
    expect(h.onEnded).not.toHaveBeenCalled();
    expect(h.onAdmitted).not.toHaveBeenCalled();
  });

  it("does not fire for a guest who was admitted first", async () => {
    const h = harness({ poll: ["waiting", "admitted"] });
    await h.session.start();
    await advance(10_000);
    expect(h.onAdmitted).toHaveBeenCalledTimes(1);

    await advance(ADMISSION_MAX_WAIT_MS + 5_000);
    expect(h.onGaveUp).not.toHaveBeenCalled();
  });

  it("does not fire after an ordinary cancel", async () => {
    const h = harness();
    await h.session.start();
    h.session.stop();
    await advance(ADMISSION_MAX_WAIT_MS + 5_000);
    expect(h.onGaveUp).not.toHaveBeenCalled();
  });

  // The copy-only timeout still behaves as it always did, well before the end.
  it("leaves the two-minute timeout doing its own job", async () => {
    const h = harness();
    await h.session.start();
    await advance(ADMISSION_TIMEOUT_MS + 1_000);
    expect(h.onTimedOut).toHaveBeenCalledTimes(1);
    expect(h.onGaveUp).not.toHaveBeenCalled();
    h.session.stop();
  });
});
