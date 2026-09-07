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
import { ADMISSION_TIMEOUT_MS, createAdmissionSession } from "./admission-session";

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
  };

  const session = createAdmissionSession({
    ...cb,
    knock: async () => { calls.knock += 1; return knockAnswers.length > 1 ? knockAnswers.shift()! : knockAnswers[0] ?? "waiting"; },
    poll: async () => { calls.poll += 1; return pollAnswers.length > 1 ? pollAnswers.shift()! : pollAnswers[0] ?? "waiting"; },
  });

  return { session, calls, ...cb };
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
      poll: async () => "waiting",
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
      knock: async () => "waiting",
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
      knock: async () => "waiting",
      poll: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((r) => { hang.release = r; });
        inFlight -= 1;
        return "waiting";
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
      knock: async () => "waiting",
      poll: async () => {
        await new Promise<void>((r) => { hang.release = r; });
        return "admitted";
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
      knock: async () => { knocks += 1; return "waiting"; },
      poll: async () => {
        await new Promise<void>((r) => { hang.release = r; });
        return "unknown";
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
