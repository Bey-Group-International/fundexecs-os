/**
 * The loop that goes back for a device the meeting started without.
 *
 * A .tsx file so it runs in the jsdom project: this reaches for
 * `navigator.mediaDevices` and `navigator.permissions`, and mocking those away
 * would test something other than what ships.
 *
 * Fake timers throughout, so a ten-minute backoff costs no wall-clock.
 */
import { REACQUIRE_GIVE_UP_MS } from "./device-reacquire";
import { startReacquire } from "./reacquire-loop";

/** Drain microtasks without advancing the clock. */
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** Advance fake timers in slices, flushing between — the schedule is a chain. */
async function advance(ms: number) {
  const STEP = 500;
  let left = ms;
  await flush();
  while (left > 0) {
    const slice = Math.min(STEP, left);
    jest.advanceTimersByTime(slice);
    left -= slice;
    await flush();
  }
}

/** A stand-in for navigator.mediaDevices that the test can fire events on. */
function fakeMediaDevices() {
  const target = new EventTarget();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    },
  });
  return { plugIn: () => target.dispatchEvent(new Event("devicechange")) };
}

/** A permission status the test can flip, as navigator.permissions reports one. */
function fakePermissions(initial: string) {
  const status = new EventTarget() as EventTarget & { state: string };
  status.state = initial;
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: async () => status },
  });
  return {
    grant: () => { status.state = "granted"; status.dispatchEvent(new Event("change")); },
    refuseAgain: () => { status.state = "denied"; status.dispatchEvent(new Event("change")); },
  };
}

/** No permissions API at all — Firefox for a camera query, and older Safari. */
function noPermissions() {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: async () => { throw new TypeError("unsupported"); } },
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  fakeMediaDevices();
  noPermissions();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("a device something else is holding", () => {
  it("asks again, and keeps asking while it keeps failing", async () => {
    const attempt = jest.fn(async () => false);
    const stop = startReacquire({ watch: "poll", attempt });

    expect(attempt).not.toHaveBeenCalled(); // nothing on the spot: the join just failed
    await advance(2_000);
    expect(attempt).toHaveBeenCalledTimes(1);
    await advance(5_000);
    expect(attempt).toHaveBeenCalledTimes(2);
    stop();
  });

  // The whole point: Zoom is quit, the camera frees, and nobody had to notice.
  it("stops the moment the device comes back", async () => {
    let free = false;
    const attempt = jest.fn(async () => free);
    const onRecovered = jest.fn();
    startReacquire({ watch: "poll", attempt, onRecovered });

    await advance(2_000);
    expect(onRecovered).not.toHaveBeenCalled();

    free = true;
    await advance(5_000);
    expect(onRecovered).toHaveBeenCalledTimes(1);

    const settled = attempt.mock.calls.length;
    await advance(120_000);
    expect(attempt).toHaveBeenCalledTimes(settled);
  });

  it("gives up rather than running for the whole meeting", async () => {
    const onGaveUp = jest.fn();
    startReacquire({ watch: "poll", attempt: async () => false, onGaveUp });

    await advance(REACQUIRE_GIVE_UP_MS + 120_000);
    expect(onGaveUp).toHaveBeenCalledTimes(1);
  });

  it("asks nothing more once stopped", async () => {
    const attempt = jest.fn(async () => false);
    const stop = startReacquire({ watch: "poll", attempt });
    stop();
    await advance(120_000);
    expect(attempt).not.toHaveBeenCalled();
  });

  it("survives an attempt that throws instead of resolving", async () => {
    const attempt = jest.fn(async () => { throw new Error("getUserMedia exploded"); });
    startReacquire({ watch: "poll", attempt });

    await advance(2_000);
    expect(attempt).toHaveBeenCalledTimes(1);
    // The schedule carries on: a thrown attempt is still just a failed one.
    await advance(5_000);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});

describe("hardware appearing", () => {
  it("tries at once rather than waiting out the interval", async () => {
    const devices = fakeMediaDevices();
    const attempt = jest.fn(async () => false);
    startReacquire({ watch: "poll", attempt });

    // Deep into the backoff, where the next scheduled ask is a minute away.
    await advance(60_000);
    const scheduled = attempt.mock.calls.length;

    devices.plugIn();
    await flush();
    expect(attempt).toHaveBeenCalledTimes(scheduled + 1);
  });

  // A dock reconnecting emits several of these in a row, and each one must not
  // start its own getUserMedia beside the one already in flight.
  it("does not stack attempts when the events arrive in a burst", async () => {
    const devices = fakeMediaDevices();
    let release: (v: boolean) => void = () => {};
    const attempt = jest.fn(() => new Promise<boolean>((r) => { release = r; }));
    startReacquire({ watch: "poll", attempt });

    await advance(2_000);
    expect(attempt).toHaveBeenCalledTimes(1);

    devices.plugIn();
    devices.plugIn();
    devices.plugIn();
    await flush();
    expect(attempt).toHaveBeenCalledTimes(1);

    release(false);
    await flush();
  });

  it("restarts the backoff from the front, since something actually changed", async () => {
    const devices = fakeMediaDevices();
    const attempt = jest.fn(async () => false);
    startReacquire({ watch: "poll", attempt });

    await advance(120_000);
    devices.plugIn();
    await flush();
    // The event's own attempt takes the first slot of the restarted schedule,
    // so the one after it is due at five seconds — not at the minute the
    // backoff had climbed to before the webcam was plugged in.
    const afterEvent = attempt.mock.calls.length;

    await advance(4_000);
    expect(attempt).toHaveBeenCalledTimes(afterEvent);
    await advance(1_500);
    expect(attempt).toHaveBeenCalledTimes(afterEvent + 1);
  });

  it("leaves the listener behind when it stops", async () => {
    const devices = fakeMediaDevices();
    const attempt = jest.fn(async () => false);
    const stop = startReacquire({ watch: "poll", attempt });
    stop();

    devices.plugIn();
    await flush();
    expect(attempt).not.toHaveBeenCalled();
  });
});

describe("a permission the browser refused", () => {
  // Polling this can never succeed, so the loop must not spend anything on it.
  it("never polls", async () => {
    fakePermissions("denied");
    const attempt = jest.fn(async () => false);
    startReacquire({ watch: "permission", permissionName: "camera", attempt });

    await advance(REACQUIRE_GIVE_UP_MS);
    expect(attempt).not.toHaveBeenCalled();
  });

  it("tries the moment the member grants it", async () => {
    const permission = fakePermissions("prompt");
    const attempt = jest.fn(async () => true);
    const onRecovered = jest.fn();
    startReacquire({ watch: "permission", permissionName: "camera", attempt, onRecovered });

    await flush(); // the query resolves and the listener attaches
    permission.grant();
    await flush();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  // A permission moving to denied means the next attempt would fail. Firing one
  // would be work spent confirming what we already know.
  it("ignores a change that is not a grant", async () => {
    const permission = fakePermissions("prompt");
    const attempt = jest.fn(async () => false);
    startReacquire({ watch: "permission", permissionName: "camera", attempt });

    await flush();
    permission.refuseAgain();
    await flush();
    expect(attempt).not.toHaveBeenCalled();
  });

  // Firefox throws on these names rather than resolving. That must cost the
  // member nothing worse than not having this one trigger.
  it("does not break where the browser will not report permissions", async () => {
    noPermissions();
    const attempt = jest.fn(async () => false);
    const stop = startReacquire({ watch: "poll", permissionName: "camera", attempt });

    await advance(2_000);
    expect(attempt).toHaveBeenCalledTimes(1);
    stop();
  });

  // A grant is worth acting on however the first failure was classified: a
  // device held elsewhere reports as denied on some browsers and in_use on
  // others.
  it("acts on a grant even when it was polling", async () => {
    const permission = fakePermissions("prompt");
    const attempt = jest.fn(async () => false);
    startReacquire({ watch: "poll", permissionName: "microphone", attempt });

    await flush();
    const before = attempt.mock.calls.length;
    permission.grant();
    await flush();
    expect(attempt).toHaveBeenCalledTimes(before + 1);
  });
});

describe("a device that cannot do what was asked", () => {
  it("does nothing at all", async () => {
    const devices = fakeMediaDevices();
    const permission = fakePermissions("prompt");
    const attempt = jest.fn(async () => false);
    startReacquire({ watch: "never", permissionName: "camera", attempt });

    await advance(REACQUIRE_GIVE_UP_MS);
    devices.plugIn();
    permission.grant();
    await flush();
    expect(attempt).not.toHaveBeenCalled();
  });
});
