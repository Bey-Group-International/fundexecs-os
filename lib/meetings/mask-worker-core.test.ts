// What the worker's frame loop does, and above all what it closes.
//
// A VideoFrame holds a slot in a pool of single digits. Miss one `close()` and
// nothing throws and nothing slows down: about four more frames go out and then
// the pipeline stops for good, with somebody's face frozen mid-sentence on every
// screen in the call. That is not a failure a reviewer can see by reading, and
// it is not one a browser reports -- so it is the property these tests are built
// around, including on the paths where something has already gone wrong.

import {
  MaskFrameLoop,
  createTimestampFloor,
  monotonicSegmenter,
  type FrameLoopDeps,
  type FrameSegmenter,
  type IncomingFrame,
} from "./mask-worker-core";
import type { MaskSample, Surface2D } from "./mask-compositor";
import { FRAME_BUDGET_MS, OUTPUT_FPS, SLOW_FRAME_RUN, frameIntervalMs } from "./backgrounds";
import type { TimingReport } from "./mask-worker-protocol";

/**
 * One camera frame's worth of clock, rounded up.
 *
 * The loop paces, so a test that feeds several frames has to move the clock
 * between them or the second one lands inside the first one's interval and is
 * correctly skipped. Rounded up rather than down because the pacing rule allows
 * a frame a quarter of an interval early, and a test should not be sitting on
 * that tolerance.
 */
const FRAME_MS = Math.ceil(frameIntervalMs(OUTPUT_FPS));

/** A camera frame that counts its own closes. */
function incoming(over: Partial<IncomingFrame> = {}) {
  const state = { closes: 0 };
  const frame: IncomingFrame = {
    displayWidth: 640,
    displayHeight: 480,
    timestamp: 1_000,
    duration: 33_000,
    close() { state.closes += 1; },
    ...over,
  };
  return { frame, state };
}

/** A composited frame on the way out, which also counts its closes. */
interface Out { id: number; timestamp: number; duration?: number; closes: number }

interface Harness {
  deps: FrameLoopDeps<"mask", Out>;
  loop: MaskFrameLoop<"mask", Out>;
  /** Everything the loop did, in order, so ordering can be asserted. */
  calls: string[];
  built: Out[];
  errors: string[];
  stats: TimingReport[];
  announced: number[];
  slow: number[];
  /**
   * Hand the loop a frame from a camera delivering at the paced rate.
   *
   * `now()` moves a millisecond per reading, which is nowhere near a frame, so
   * the gap between frames is put here explicitly rather than left implicit in
   * how many times the loop happens to read the clock.
   */
  feed: (over?: Partial<IncomingFrame>) => boolean;
  /** Flip to make the next readback return nothing. */
  control: {
    callbackRuns: boolean;
    sample: MaskSample | null;
    deliverAccepts: boolean;
    composeThrows: boolean;
    readThrows: boolean;
    makeThrows: boolean;
    clock: number;
    /** Milliseconds the clock moves per reading, so a frame can be made slow. */
    tick: number;
    /** Resolve delivery by hand, to model a `write` that settles later. */
    deliverAsync: boolean;
    settleDeliver: ((accepted: boolean) => void) | null;
  };
}

function harness(over: Partial<FrameLoopDeps<"mask", Out>> = {}): Harness {
  const calls: string[] = [];
  const built: Out[] = [];
  const errors: string[] = [];
  const stats: TimingReport[] = [];
  const announced: number[] = [];
  const slow: number[] = [];
  const control: Harness["control"] = {
    callbackRuns: true,
    sample: { kind: "confidence", data: new Float32Array(4), width: 2, height: 2 },
    deliverAccepts: true,
    composeThrows: false,
    readThrows: false,
    makeThrows: false,
    clock: 0,
    tick: 1,
    deliverAsync: false,
    settleDeliver: null,
  };
  const surface = { width: 640, height: 480 } as unknown as Surface2D;
  let nextId = 0;

  const deps: FrameLoopDeps<"mask", Out> = {
    compositor: {
      surface,
      prepareSegmentInput: () => { calls.push("prepare"); return surface; },
      compose: () => {
        calls.push("compose");
        if (control.composeThrows) throw new Error("compose blew up");
      },
      passThrough: () => { calls.push("passThrough"); },
    },
    segmenter: {
      segmentForVideo: (_input, ts, cb) => {
        calls.push(`segment:${ts}`);
        if (control.callbackRuns) cb("mask");
      },
    },
    readMask: () => {
      calls.push("readMask");
      if (control.readThrows) throw new Error("readback blew up");
      return control.sample;
    },
    closeMask: () => { calls.push("closeMask"); },
    makeFrame: (_s, init) => {
      calls.push("makeFrame");
      if (control.makeThrows) throw new Error("no frame slots");
      const out: Out = { id: nextId++, timestamp: init.timestamp, duration: init.duration, closes: 0 };
      built.push(out);
      return out;
    },
    deliver: () => {
      calls.push("deliver");
      if (!control.deliverAsync) return control.deliverAccepts;
      return new Promise<boolean>((resolve) => { control.settleDeliver = resolve; });
    },
    closeFrame: (f) => { calls.push("closeFrame"); f.closes += 1; },
    // Advances a fixed amount per reading, so the timings below are exact
    // rather than wall-clock flakes. Raise `tick` to make a frame over budget.
    now: () => { control.clock += control.tick; return control.clock; },
    onDelivered: (i) => { announced.push(i); },
    onStats: (r) => { stats.push(r); },
    onSlowFrames: (n) => { slow.push(n); },
    onError: (r) => { errors.push(r); },
    ...over,
  };

  const loop = new MaskFrameLoop(deps);
  const feed = (frameOver: Partial<IncomingFrame> = {}) => {
    control.clock += FRAME_MS;
    return loop.handle(incoming(frameOver).frame);
  };

  return { deps, loop, feed, calls, built, errors, stats, announced, slow, control };
}

describe("the incoming frame is always closed", () => {
  it("on the ordinary path", () => {
    const h = harness();
    const { frame, state } = incoming();
    expect(h.loop.handle(frame)).toBe(true);
    expect(state.closes).toBe(1);
  });

  it("when the segmenter has not loaded yet", () => {
    const h = harness({ segmenter: null });
    const { frame, state } = incoming();
    h.loop.handle(frame);
    expect(state.closes).toBe(1);
    expect(h.calls).toContain("passThrough");
  });

  it("when the readback throws", () => {
    const h = harness();
    h.control.readThrows = true;
    const { frame, state } = incoming();
    h.loop.handle(frame);
    expect(state.closes).toBe(1);
  });

  it("when the chain throws", () => {
    const h = harness();
    h.control.composeThrows = true;
    const { frame, state } = incoming();
    h.loop.handle(frame);
    expect(state.closes).toBe(1);
  });

  it("when building the outgoing frame throws", () => {
    const h = harness();
    h.control.makeThrows = true;
    const { frame, state } = incoming();
    expect(h.loop.handle(frame)).toBe(false);
    expect(state.closes).toBe(1);
  });

  it("when the sink refuses it", () => {
    const h = harness();
    h.control.deliverAccepts = false;
    const { frame, state } = incoming();
    h.loop.handle(frame);
    expect(state.closes).toBe(1);
  });

  it("when the frame arrives after stop", () => {
    const h = harness();
    h.loop.stop();
    const { frame, state } = incoming();
    expect(h.loop.handle(frame)).toBe(false);
    expect(state.closes).toBe(1);
    expect(h.calls).toEqual([]);
  });

  it("when the frame has no usable size", () => {
    const h = harness();
    const { frame, state } = incoming({ displayWidth: 0, displayHeight: 0 });
    expect(h.loop.handle(frame)).toBe(false);
    expect(state.closes).toBe(1);
  });

  it("even when closing it throws", () => {
    const h = harness();
    const { frame } = incoming({ close() { throw new Error("already closed"); } });
    expect(() => h.loop.handle(frame)).not.toThrow();
  });
});

describe("the outgoing frame", () => {
  /**
   * A sink that refused the frame never took ownership of it. Left unclosed,
   * this is the case that quietly exhausts the pool when a call ends with frames
   * still in flight -- and it is invisible, because the sink being gone is
   * exactly when nobody is looking at the output.
   */
  it("is closed when the sink refuses it", () => {
    const h = harness();
    h.control.deliverAccepts = false;
    h.loop.handle(incoming().frame);
    expect(h.built).toHaveLength(1);
    expect(h.built[0].closes).toBe(1);
  });

  it("is not closed when the sink took it", () => {
    const h = harness();
    h.loop.handle(incoming().frame);
    expect(h.built[0].closes).toBe(0);
  });

  it("carries the camera frame's own timestamp", () => {
    const h = harness();
    h.loop.handle(incoming({ timestamp: 123_456 }).frame);
    expect(h.built[0].timestamp).toBe(123_456);
  });

  it("carries a duration only when the camera gave one", () => {
    const h = harness();
    h.loop.handle(incoming({ duration: 33_000 }).frame);
    expect(h.built[0].duration).toBe(33_000);

    const g = harness();
    g.loop.handle(incoming({ duration: null }).frame);
    expect(g.built[0].duration).toBeUndefined();

    const z = harness();
    z.loop.handle(incoming({ duration: 0 }).frame);
    expect(z.built[0].duration).toBeUndefined();
  });
});

describe("the mask handles", () => {
  it("are closed on the ordinary path", () => {
    const h = harness();
    h.loop.handle(incoming().frame);
    expect(h.calls.filter((c) => c === "closeMask")).toHaveLength(1);
  });

  it("are closed when the readback throws", () => {
    const h = harness();
    h.control.readThrows = true;
    h.loop.handle(incoming().frame);
    expect(h.calls).toContain("closeMask");
  });

  it("are closed when the chain throws", () => {
    const h = harness();
    h.control.composeThrows = true;
    h.loop.handle(incoming().frame);
    expect(h.calls).toContain("closeMask");
  });

  it("are closed before the chain's exception escapes", () => {
    const h = harness();
    h.control.composeThrows = true;
    h.loop.handle(incoming().frame);
    expect(h.calls.indexOf("closeMask")).toBeGreaterThan(h.calls.indexOf("compose"));
  });
});

describe("a frame the segmenter did not mask", () => {
  /**
   * The output surface still holds the PREVIOUS frame. Delivering it as-is is
   * the worst outcome available: a still picture that looks like live video, so
   * nobody in the call knows anything is wrong.
   */
  it("is repainted rather than delivered stale, when the callback never ran", () => {
    const h = harness();
    h.control.callbackRuns = false;
    expect(h.loop.handle(incoming().frame)).toBe(true);
    expect(h.calls).toContain("passThrough");
    expect(h.calls.indexOf("passThrough")).toBeGreaterThan(h.calls.indexOf("prepare"));
  });

  it("is repainted when the readback returned nothing", () => {
    const h = harness();
    h.control.sample = null;
    h.loop.handle(incoming().frame);
    expect(h.calls).toContain("passThrough");
    expect(h.calls).not.toContain("compose");
  });

  it("says so, once, rather than every frame", () => {
    const h = harness();
    h.control.callbackRuns = false;
    for (let i = 0; i < 10; i++) h.feed({ timestamp: 1_000 + i });
    expect(h.errors.filter((e) => e.startsWith("no-mask"))).toHaveLength(1);
  });
});

/**
 * The loop starts before the segmenter exists, and that ordering is the
 * requirement rather than an accident: the runtime is a 12MB download and the
 * camera's frames are already flowing, so an unmasked frame goes out rather than
 * none at all.
 */
describe("the segmenter arriving late", () => {
  it("passes frames through until it lands", () => {
    const h = harness({ segmenter: null });
    h.loop.handle(incoming({ timestamp: 1 }).frame);
    expect(h.calls).toEqual(["passThrough", "makeFrame", "deliver"]);
    expect(h.loop.framesDelivered).toBe(1);
  });

  it("starts masking from the frame after it lands", () => {
    const h = harness({ segmenter: null });
    h.feed({ timestamp: 1 });
    h.loop.setSegmenter({
      segmentForVideo: (_i, ts, cb) => { h.calls.push(`segment:${ts}`); cb("mask"); },
    });
    h.feed({ timestamp: 2 });

    expect(h.calls).toContain("segment:2");
    expect(h.calls).toContain("compose");
    expect(h.loop.framesDelivered).toBe(2);
  });

  it("goes back to passing through if it is taken away", () => {
    const h = harness();
    h.feed({ timestamp: 1 });
    h.loop.setSegmenter(null);
    const before = h.calls.length;
    h.feed({ timestamp: 2 });
    expect(h.calls.slice(before)).toEqual(["passThrough", "makeFrame", "deliver"]);
  });
});

describe("the segmenter's timestamp", () => {
  it("is the frame's own when it advances", () => {
    const h = harness();
    h.feed({ timestamp: 5_000 });
    h.feed({ timestamp: 6_000 });
    expect(h.calls.filter((c) => c.startsWith("segment:"))).toEqual(["segment:5000", "segment:6000"]);
  });

  /** MediaPipe rejects a timestamp that does not advance, and two frames can
   *  carry the same one -- a camera reporting in milliseconds, or a synthetic
   *  track. */
  it("is nudged forward when two frames share one", () => {
    const h = harness();
    h.feed({ timestamp: 5_000 });
    h.feed({ timestamp: 5_000 });
    h.feed({ timestamp: 4_000 });
    expect(h.calls.filter((c) => c.startsWith("segment:")))
      .toEqual(["segment:5000", "segment:5001", "segment:5002"]);
  });

  it("survives a frame with no timestamp at all", () => {
    const h = harness();
    h.loop.handle(incoming({ timestamp: Number.NaN }).frame);
    expect(h.calls.filter((c) => c.startsWith("segment:"))).toEqual(["segment:0"]);
  });
});

describe("what the deadline reads", () => {
  it("counts only frames that reached the sink", () => {
    const h = harness();
    h.feed({ timestamp: 1 });
    expect(h.loop.framesDelivered).toBe(1);

    h.control.deliverAccepts = false;
    h.feed({ timestamp: 2 });
    expect(h.loop.framesDelivered).toBe(1);
  });

  /** The main thread's first-frame deadline turns on this being zero until a
   *  frame really arrives -- a worker that composites perfectly into a sink
   *  nobody is reading is still a black tile. */
  it("stays at zero while nothing is accepted", () => {
    const h = harness();
    h.control.deliverAccepts = false;
    for (let i = 0; i < 5; i++) h.feed({ timestamp: i });
    expect(h.loop.framesDelivered).toBe(0);
  });
});

/**
 * `MediaStreamTrackProcessor` delivers at the CAMERA's rate -- 30fps commonly,
 * 60 on plenty of laptops -- not at the rate the output is captured at. Nothing
 * in this loop was throttling it, and that is not merely wasted work.
 *
 * The temporal blend in `backgrounds.ts` is a PER-FRAME filter whose constants
 * were measured at OUTPUT_FPS, so running it two and a half times too fast
 * shrinks its time constant by the same factor and most of the flicker
 * suppression goes with it -- a shimmering edge. And a machine asked for 2.5x
 * the work it was budgeted for stops keeping up, which arrives as judder on
 * movement. The main thread's loop has always paced through this same rule;
 * moving the work into the worker is what dropped it.
 */
describe("pacing to the output rate", () => {
  it("always draws the first frame", () => {
    const h = harness();
    // Not after an interval: the canvas is captured the instant an effect is
    // chosen, so waiting even one frame would put a black frame on the wire.
    expect(h.loop.handle(incoming().frame)).toBe(true);
    expect(h.calls).toContain("makeFrame");
  });

  it("skips a frame that arrives inside the interval it already drew", () => {
    const h = harness();
    h.loop.handle(incoming().frame);
    const before = h.calls.length;

    h.control.clock += 5;
    expect(h.loop.handle(incoming().frame)).toBe(false);
    expect(h.calls.slice(before)).toEqual([]);
  });

  /** The property the whole file is arranged around still holds on the new
   *  path: a frame nobody drew is a frame nobody closed, and four of those end
   *  the call. */
  it("still closes a frame it skipped", () => {
    const h = harness();
    h.loop.handle(incoming().frame);
    h.control.clock += 5;
    const { frame, state } = incoming();
    h.loop.handle(frame);
    expect(state.closes).toBe(1);
  });

  it("draws again once an interval has passed", () => {
    const h = harness();
    h.loop.handle(incoming().frame);
    h.control.clock += FRAME_MS;
    expect(h.loop.handle(incoming().frame)).toBe(true);
    expect(h.calls.filter((c) => c === "makeFrame")).toHaveLength(2);
  });

  /**
   * A camera at twice the output rate should cost half its frames, not all of
   * them and not none. This is the number the fix exists for.
   */
  it("keeps one frame in two from a camera running at twice the rate", () => {
    const h = harness();
    const half = Math.ceil(FRAME_MS / 2);
    for (let i = 0; i < 20; i++) {
      h.control.clock += half;
      h.loop.handle(incoming({ timestamp: i }).frame);
    }
    expect(h.loop.framesDelivered).toBe(10);
  });

  /** Measured from the frame it DREW. Pacing from the last frame it merely saw
   *  would skip forever behind a fast camera. */
  it("paces from the frame it drew, not the ones it skipped", () => {
    const h = harness();
    h.loop.handle(incoming().frame);
    for (let i = 0; i < 4; i++) {
      h.control.clock += 8;
      h.loop.handle(incoming().frame);
    }
    expect(h.loop.framesDelivered).toBe(2);
  });

  /** Skipping is only ever an optimisation, so a clock that went backwards must
   *  not be able to freeze the picture. `shouldDrawFrame` owns this; the test is
   *  here because this is the caller that would show it. */
  it("draws rather than stalls when the clock goes backwards", () => {
    const h = harness();
    h.loop.handle(incoming().frame);
    h.control.clock -= 10_000;
    expect(h.loop.handle(incoming().frame)).toBe(true);
  });
});

/**
 * The main thread's processor has always reported a run of over-budget frames,
 * and the room suspends the effect on a long one. The worker did not -- so once
 * the room moved onto the worker NOTHING was watching whether the machine could
 * keep up, on the path the member spends the whole call on.
 */
describe("the slow frames it reports", () => {
  /** Readings per frame on the masked path, so a test can price one. */
  const READINGS = 5;
  const overBudget = Math.ceil((FRAME_BUDGET_MS + 1) / READINGS);

  it("says nothing while frames are inside the budget", () => {
    const h = harness();
    for (let i = 0; i < 5; i++) h.feed({ timestamp: i });
    expect(h.slow).toEqual([]);
  });

  it("counts a run of over-budget frames", () => {
    const h = harness();
    h.control.tick = overBudget;
    for (let i = 0; i < 3; i++) h.feed({ timestamp: i });
    expect(h.slow).toEqual([1, 2, 3]);
  });

  it("goes back to zero when a frame comes in under budget, once", () => {
    const h = harness();
    h.control.tick = overBudget;
    h.feed({ timestamp: 1 });
    h.control.tick = 1;
    h.feed({ timestamp: 2 });
    h.feed({ timestamp: 3 });
    // The zero is reported once, not on every good frame after it: the room
    // reads this to decide whether to suspend the effect, and a stream of
    // zeroes is a message per frame saying nothing changed.
    expect(h.slow).toEqual([1, 0]);
  });

  /** The threshold the room acts on lives in `backgrounds.ts`; this only has to
   *  reach it, which a run of over-budget frames must. */
  it("reaches the run the room suspends on", () => {
    const h = harness();
    h.control.tick = overBudget;
    for (let i = 0; i < SLOW_FRAME_RUN; i++) h.feed({ timestamp: i });
    expect(h.slow[h.slow.length - 1]).toBe(SLOW_FRAME_RUN);
  });

  /** A frame the sink refused never cost the machine the rest of the chain, and
   *  counting it would convict the hardware of a closed stream. */
  /** The budget is a ceiling a frame may touch. 45ms is already longer than one
   *  animation frame at any refresh rate in use, so convicting a machine that
   *  lands exactly on it would suspend effects that are keeping up. */
  it("does not count a frame that lands exactly on the budget", () => {
    const h = harness();
    h.control.tick = FRAME_BUDGET_MS / READINGS;
    for (let i = 0; i < 3; i++) h.feed({ timestamp: i });
    expect(h.slow).toEqual([]);
  });

  it("does not count a frame the sink refused", () => {
    const h = harness();
    h.control.tick = overBudget;
    h.control.deliverAccepts = false;
    for (let i = 0; i < 3; i++) h.feed({ timestamp: i });
    expect(h.slow).toEqual([]);
  });
});

describe("the timing it reports", () => {
  it("reports once per interval, not per frame", () => {
    const h = harness();
    for (let i = 0; i < 24; i++) h.feed({ timestamp: i });
    expect(h.stats).toHaveLength(1);
    expect(h.stats[0].frames).toBe(24);
  });

  it("splits the readback from the rest of the chain", () => {
    const h = harness();
    for (let i = 0; i < 24; i++) h.feed({ timestamp: i });
    // The fake clock ticks 1ms per reading, so each measured span is exactly 1.
    expect(h.stats[0].readbackMsPerFrame).toBe(1);
    expect(h.stats[0].chainMsPerFrame).toBe(1);
    expect(h.stats[0].totalMsPerFrame).toBeGreaterThan(h.stats[0].readbackMsPerFrame);
  });

  /**
   * Each report describes its own second. Cumulative averages would let every
   * good frame before a machine got into trouble average the trouble back out,
   * which is the opposite of what the number is for.
   */
  it("starts a fresh window after each report", () => {
    const h = harness();
    for (let i = 0; i < 48; i++) h.feed({ timestamp: i });
    expect(h.stats).toHaveLength(2);
    expect(h.stats[1].frames).toBe(24);
  });

  it("counts a frame nobody accepted in no window at all", () => {
    const h = harness();
    h.control.deliverAccepts = false;
    for (let i = 0; i < 48; i++) h.feed({ timestamp: i });
    expect(h.stats).toHaveLength(0);
  });
});

describe("what it reports as broken", () => {
  it("names the cause once per cause", () => {
    const h = harness();
    h.control.makeThrows = true;
    for (let i = 0; i < 5; i++) h.feed({ timestamp: i });
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toContain("no frame slots");
  });

  it("distinguishes a build failure from a delivery failure", () => {
    const h = harness();
    h.control.makeThrows = true;
    h.loop.handle(incoming({ timestamp: 1 }).frame);
    h.control.makeThrows = false;
    h.control.deliverAccepts = true;
    const throwing = harness({ deliver: () => { throw new Error("writable closed"); } });
    throwing.loop.handle(incoming({ timestamp: 1 }).frame);

    expect(h.errors[0]).toMatch(/^frame-build-failed/);
    expect(throwing.errors[0]).toMatch(/^deliver-failed/);
  });

  it("does not let a sink that throws take the loop down", () => {
    const h = harness({ deliver: () => { throw new Error("writable closed"); } });
    const { frame, state } = incoming();
    expect(() => h.loop.handle(frame)).not.toThrow();
    expect(state.closes).toBe(1);
    expect(h.built[0].closes).toBe(1);
  });
});

/**
 * A real sink is a `WritableStream` whose `write` settles later, so the frame is
 * only delivered when it does.
 *
 * Counting it before then is not cosmetic: a write that rejects did not consume
 * its chunk, and the count is what clears the main thread's first-frame
 * deadline. Counting optimistically would clear the deadline on a frame that
 * never arrived -- in exactly the case the deadline exists to catch, a sink that
 * was already gone.
 */
describe("delivery that settles later", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("counts nothing until the write fulfills", async () => {
    const h = harness();
    h.control.deliverAsync = true;
    h.loop.handle(incoming({ timestamp: 1 }).frame);

    expect(h.loop.framesDelivered).toBe(0);
    expect(h.announced).toEqual([]);

    h.control.settleDeliver!(true);
    await flush();

    expect(h.loop.framesDelivered).toBe(1);
    expect(h.announced).toEqual([1]);
  });

  it("closes the frame and counts nothing when the write rejects", async () => {
    const h = harness();
    h.control.deliverAsync = true;
    h.loop.handle(incoming({ timestamp: 1 }).frame);
    h.control.settleDeliver!(false);
    await flush();

    expect(h.loop.framesDelivered).toBe(0);
    expect(h.announced).toEqual([]);
    expect(h.built[0].closes).toBe(1);
  });

  it("closes the frame when the write throws rather than resolving", async () => {
    const h = harness({ deliver: () => Promise.reject(new Error("stream closed")) });
    h.loop.handle(incoming({ timestamp: 1 }).frame);
    await flush();

    expect(h.loop.framesDelivered).toBe(0);
    expect(h.built[0].closes).toBe(1);
  });

  it("does not fold a rejected frame's timing into the averages", async () => {
    const h = harness();
    h.control.deliverAsync = true;
    for (let i = 0; i < 48; i++) {
      h.feed({ timestamp: i });
      h.control.settleDeliver!(false);
      await flush();
    }
    expect(h.stats).toHaveLength(0);
  });

  it("still announces only the first accepted frame", async () => {
    const h = harness();
    h.control.deliverAsync = true;
    for (let i = 0; i < 3; i++) {
      h.feed({ timestamp: i });
      h.control.settleDeliver!(true);
      await flush();
    }
    expect(h.announced).toEqual([1, 2, 3]);
  });

  it("still works for a sink that answers synchronously", () => {
    const h = harness();
    expect(h.loop.handle(incoming({ timestamp: 1 }).frame)).toBe(true);
    expect(h.loop.framesDelivered).toBe(1);
    expect(h.announced).toEqual([1]);
  });
});

/**
 * MediaPipe in VIDEO mode rejects a timestamp that does not advance past the
 * last one THAT INSTANCE saw, and the instance is cached per worker while a loop
 * is built per session.
 *
 * So a device switch mid-call resets the loop's floor but not the segmenter's,
 * and a new camera whose timestamps start lower gets every frame rejected. The
 * main thread's fallback is a one-way latch, so that transient clash would cost
 * the member the worker for the rest of the call with nothing wrong with their
 * browser.
 */
describe("the segmenter's floor across sessions", () => {
  function recording() {
    const seen: number[] = [];
    const inner: FrameSegmenter<"mask"> = {
      segmentForVideo: (_i, ts, cb) => { seen.push(ts); cb("mask"); },
    };
    return { inner, seen };
  }

  it("passes an advancing timestamp straight through", () => {
    const { inner, seen } = recording();
    const guarded = monotonicSegmenter(inner, createTimestampFloor());
    guarded.segmentForVideo({} as never, 1_000, () => {});
    guarded.segmentForVideo({} as never, 2_000, () => {});
    expect(seen).toEqual([1_000, 2_000]);
  });

  it("nudges a timestamp that went backwards", () => {
    const { inner, seen } = recording();
    const guarded = monotonicSegmenter(inner, createTimestampFloor());
    guarded.segmentForVideo({} as never, 5_000, () => {});
    guarded.segmentForVideo({} as never, 1_000, () => {});
    guarded.segmentForVideo({} as never, 1_000, () => {});
    expect(seen).toEqual([5_000, 5_001, 5_002]);
  });

  /** The case the floor exists for: a new camera starting lower than the old. */
  it("holds across the loops that share one segmenter", () => {
    const { inner, seen } = recording();
    const floor = createTimestampFloor();

    const first = new MaskFrameLoop(harness({ segmenter: monotonicSegmenter(inner, floor) }).deps);
    first.handle(incoming({ timestamp: 900_000 }).frame);

    // A device switch: a brand new loop, whose own floor is back at -1.
    const second = new MaskFrameLoop(harness({ segmenter: monotonicSegmenter(inner, floor) }).deps);
    second.handle(incoming({ timestamp: 1_000 }).frame);

    expect(seen).toEqual([900_000, 900_001]);
  });

  it("survives a frame with no timestamp", () => {
    const { inner, seen } = recording();
    const guarded = monotonicSegmenter(inner, createTimestampFloor());
    guarded.segmentForVideo({} as never, Number.NaN, () => {});
    guarded.segmentForVideo({} as never, Number.NaN, () => {});
    expect(seen).toEqual([0, 1]);
  });
});
