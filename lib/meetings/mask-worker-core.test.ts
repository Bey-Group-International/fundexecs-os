// What the worker's frame loop does, and above all what it closes.
//
// A VideoFrame holds a slot in a pool of single digits. Miss one `close()` and
// nothing throws and nothing slows down: about four more frames go out and then
// the pipeline stops for good, with somebody's face frozen mid-sentence on every
// screen in the call. That is not a failure a reviewer can see by reading, and
// it is not one a browser reports -- so it is the property these tests are built
// around, including on the paths where something has already gone wrong.

import { MaskFrameLoop, type FrameLoopDeps, type IncomingFrame } from "./mask-worker-core";
import type { MaskSample, Surface2D } from "./mask-compositor";
import type { TimingReport } from "./mask-worker-protocol";

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
  /** Flip to make the next readback return nothing. */
  control: {
    callbackRuns: boolean;
    sample: MaskSample | null;
    deliverAccepts: boolean;
    composeThrows: boolean;
    readThrows: boolean;
    makeThrows: boolean;
    clock: number;
  };
}

function harness(over: Partial<FrameLoopDeps<"mask", Out>> = {}): Harness {
  const calls: string[] = [];
  const built: Out[] = [];
  const errors: string[] = [];
  const stats: TimingReport[] = [];
  const control: Harness["control"] = {
    callbackRuns: true,
    sample: { kind: "confidence", data: new Float32Array(4), width: 2, height: 2 },
    deliverAccepts: true,
    composeThrows: false,
    readThrows: false,
    makeThrows: false,
    clock: 0,
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
    deliver: () => { calls.push("deliver"); return control.deliverAccepts; },
    closeFrame: (f) => { calls.push("closeFrame"); f.closes += 1; },
    // Advances a fixed amount per reading, so the timings below are exact
    // rather than wall-clock flakes.
    now: () => { control.clock += 1; return control.clock; },
    onStats: (r) => { stats.push(r); },
    onError: (r) => { errors.push(r); },
    ...over,
  };

  return { deps, loop: new MaskFrameLoop(deps), calls, built, errors, stats, control };
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
    for (let i = 0; i < 10; i++) h.loop.handle(incoming({ timestamp: 1_000 + i }).frame);
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
    h.loop.handle(incoming({ timestamp: 1 }).frame);
    h.loop.setSegmenter({
      segmentForVideo: (_i, ts, cb) => { h.calls.push(`segment:${ts}`); cb("mask"); },
    });
    h.loop.handle(incoming({ timestamp: 2 }).frame);

    expect(h.calls).toContain("segment:2");
    expect(h.calls).toContain("compose");
    expect(h.loop.framesDelivered).toBe(2);
  });

  it("goes back to passing through if it is taken away", () => {
    const h = harness();
    h.loop.handle(incoming({ timestamp: 1 }).frame);
    h.loop.setSegmenter(null);
    const before = h.calls.length;
    h.loop.handle(incoming({ timestamp: 2 }).frame);
    expect(h.calls.slice(before)).toEqual(["passThrough", "makeFrame", "deliver"]);
  });
});

describe("the segmenter's timestamp", () => {
  it("is the frame's own when it advances", () => {
    const h = harness();
    h.loop.handle(incoming({ timestamp: 5_000 }).frame);
    h.loop.handle(incoming({ timestamp: 6_000 }).frame);
    expect(h.calls.filter((c) => c.startsWith("segment:"))).toEqual(["segment:5000", "segment:6000"]);
  });

  /** MediaPipe rejects a timestamp that does not advance, and two frames can
   *  carry the same one -- a camera reporting in milliseconds, or a synthetic
   *  track. */
  it("is nudged forward when two frames share one", () => {
    const h = harness();
    h.loop.handle(incoming({ timestamp: 5_000 }).frame);
    h.loop.handle(incoming({ timestamp: 5_000 }).frame);
    h.loop.handle(incoming({ timestamp: 4_000 }).frame);
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
    h.loop.handle(incoming({ timestamp: 1 }).frame);
    expect(h.loop.framesDelivered).toBe(1);

    h.control.deliverAccepts = false;
    h.loop.handle(incoming({ timestamp: 2 }).frame);
    expect(h.loop.framesDelivered).toBe(1);
  });

  /** The main thread's first-frame deadline turns on this being zero until a
   *  frame really arrives -- a worker that composites perfectly into a sink
   *  nobody is reading is still a black tile. */
  it("stays at zero while nothing is accepted", () => {
    const h = harness();
    h.control.deliverAccepts = false;
    for (let i = 0; i < 5; i++) h.loop.handle(incoming({ timestamp: i }).frame);
    expect(h.loop.framesDelivered).toBe(0);
  });
});

describe("the timing it reports", () => {
  it("reports once per interval, not per frame", () => {
    const h = harness();
    for (let i = 0; i < 24; i++) h.loop.handle(incoming({ timestamp: i }).frame);
    expect(h.stats).toHaveLength(1);
    expect(h.stats[0].frames).toBe(24);
  });

  it("splits the readback from the rest of the chain", () => {
    const h = harness();
    for (let i = 0; i < 24; i++) h.loop.handle(incoming({ timestamp: i }).frame);
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
    for (let i = 0; i < 48; i++) h.loop.handle(incoming({ timestamp: i }).frame);
    expect(h.stats).toHaveLength(2);
    expect(h.stats[1].frames).toBe(24);
  });

  it("counts a frame nobody accepted in no window at all", () => {
    const h = harness();
    h.control.deliverAccepts = false;
    for (let i = 0; i < 48; i++) h.loop.handle(incoming({ timestamp: i }).frame);
    expect(h.stats).toHaveLength(0);
  });
});

describe("what it reports as broken", () => {
  it("names the cause once per cause", () => {
    const h = harness();
    h.control.makeThrows = true;
    for (let i = 0; i < 5; i++) h.loop.handle(incoming({ timestamp: i }).frame);
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
