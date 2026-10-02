// What the driver does with a real Worker that will not cooperate.
//
// I claimed on #1250 that this file could not be tested because it needs a real
// `Worker`. That was wrong, and `background-processor.source.test.tsx` is the
// proof: stub the browser pieces in jsdom and drive the real class through the
// real sequence. A dedicated worker's whole interface is `postMessage`,
// `onmessage` and `terminate`, which is an object literal.
//
// It matters more here than almost anywhere. The shell is where the defects
// were on #1249 and again on this change -- eight of them, all found by reading
// rather than by running -- and the properties below are precisely the ones
// reading does not settle: which track is on the wire at which moment, in what
// order things are torn down, and what happens to a worker that is simply
// silent.

import { MaskDriver } from "./mask-driver";
import { FIRST_FRAME_DEADLINE_MS, type PipelineSupport } from "./mask-pipeline";
import type { MainToWorker, WorkerToMain } from "./mask-worker-protocol";

// Deterministic, and never reaching for WASM over the network. What the
// segmenter returns does not matter to anything in this file: the driver's job
// is to move tracks, not to mask.
// The worker construction, which webpack matches syntactically and Jest cannot
// parse: `import.meta` is illegal in the CommonJS the transform emits, so
// without this the driver cannot even be imported. The factory form means the
// real module is never loaded.
jest.mock("@/lib/meetings/mask-worker-spawn", () => ({
  spawnMaskWorker: () => new (globalThis as unknown as { Worker: new () => Worker }).Worker(),
}));

jest.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  ImageSegmenter: {
    createFromOptions: async () => ({
      segmentForVideo: (_i: unknown, _t: number, cb: (r: unknown) => void) => cb({}),
      close: () => {},
    }),
  },
}));

/** A camera track that remembers whether it was stopped, and can be cloned. */
class FakeTrack extends EventTarget {
  kind = "video";
  readyState: "live" | "ended" = "live";
  enabled = true;
  contentHint = "";
  stopped = 0;
  readonly clones: FakeTrack[] = [];
  constructor(readonly label = "camera") { super(); }
  stop() { this.stopped += 1; this.readyState = "ended"; }
  clone() { const c = new FakeTrack(`${this.label}-clone`); this.clones.push(c); return c; }
  getSettings() { return { width: 640, height: 480 }; }
}

/** The worker, as the driver is entitled to assume it behaves. */
class FakeWorker {
  static built: FakeWorker[] = [];
  readonly sent: MainToWorker[] = [];
  readonly transfers: unknown[][] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = 0;
  /** Shared with the harness, so `terminate` can be ordered against `onTrack`. */
  static log: string[] = [];
  constructor() { FakeWorker.built.push(this); }
  postMessage(message: MainToWorker, transfer: unknown[] = []) {
    this.sent.push(message);
    this.transfers.push(transfer);
  }
  terminate() { this.terminated += 1; FakeWorker.log.push("terminate"); }
  /** Speak as the worker would. */
  emit(message: WorkerToMain) { this.onmessage?.({ data: message } as MessageEvent); }
  kinds() { return this.sent.map((m) => m.kind); }
}

const WORKER_SUPPORT: PipelineSupport = {
  worker: true,
  trackProcessor: true,
  videoTrackGenerator: true,
  mediaStreamTrackGenerator: false,
  offscreenCanvas: true,
  videoFrame: true,
};

/** Every canvas captureStream track, in creation order. The first is a build's output. */
let captured: FakeTrack[] = [];

function fakeCanvas() {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      save() {}, restore() {}, clearRect() {}, drawImage() {}, fillRect() {},
      putImageData() {}, createImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
      filter: "none", globalCompositeOperation: "source-over", fillStyle: "",
    }),
    captureStream: () => {
      const track = new FakeTrack(`output-${captured.length}`);
      captured.push(track);
      return { getVideoTracks: () => [track], getTracks: () => [track] };
    },
  } as unknown as HTMLCanvasElement;
}

function fakeVideo() {
  // readyState 0 stops the frame loop before it paints, as in the processor's
  // own source test: nothing here is about what gets drawn.
  return {
    playsInline: false, muted: false, srcObject: null, readyState: 0,
    videoWidth: 0, videoHeight: 0, play: async () => {}, pause() {},
  } as unknown as HTMLVideoElement;
}

describe("MaskDriver", () => {
  let clock = 1_000;
  let createElement: jest.SpyInstance;
  let scope: Record<string, unknown>;

  beforeEach(() => {
    clock = 1_000;
    captured = [];
    FakeWorker.built = [];
    FakeWorker.log = [];
    jest.useFakeTimers();
    jest.spyOn(performance, "now").mockImplementation(() => clock);
    jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const real = document.createElement.bind(document);
    createElement = jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return fakeCanvas();
      if (tag === "video") return fakeVideo();
      return real(tag);
    });

    scope = globalThis as unknown as Record<string, unknown>;
    scope.MediaStream = class {
      constructor(private readonly tracks: unknown[] = []) {}
      getTracks() { return this.tracks; }
      getVideoTracks() { return this.tracks; }
    };
    scope.Worker = FakeWorker;
    scope.OffscreenCanvas = function () {};
    scope.VideoFrame = function () {};
    // Chrome's shape by default: both pre-standard halves on this thread, so
    // `pipelineRoute` can start without waiting for the worker to report.
    scope.MediaStreamTrackProcessor = class { readable = { kind: "readable" }; };
    scope.MediaStreamTrackGenerator = class {
      writable = { kind: "writable" };
      track = new FakeTrack("generator");
    };
    delete scope.VideoTrackGenerator;
  });

  afterEach(() => {
    createElement.mockRestore();
    jest.useRealTimers();
    jest.restoreAllMocks();
    for (const name of ["Worker", "OffscreenCanvas", "VideoFrame", "MediaStreamTrackProcessor", "MediaStreamTrackGenerator", "VideoTrackGenerator"]) {
      delete scope[name];
    }
  });

  /**
   * Let every pending microtask run.
   *
   * Generous on purpose: rebuilding the main pipeline goes through a dynamic
   * import and `video.play()`, which is a chain of awaits rather than one, and a
   * test that guessed the count would pass or fail on an implementation detail
   * of the thing it is testing.
   */
  async function flush() {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  }

  /** Build a driver over a camera, recording every track handed to the room. */
  async function build(over: { paused?: boolean; camera?: FakeTrack } = {}) {
    const camera = over.camera ?? new FakeTrack();
    const tracks: MediaStreamTrack[] = [];
    const phases: string[] = [];
    let unavailable = 0;
    const driver = await MaskDriver.create(
      camera as unknown as MediaStreamTrack,
      { kind: "blur", strength: "light" },
      {
        onTrack: (t) => { tracks.push(t); FakeWorker.log.push("track"); },
        onSlowFrames: () => {},
        onUnavailable: () => { unavailable += 1; },
        onPhase: (p) => { phases.push(p.phase); },
      },
      null,
      over.paused ?? false,
    );
    if (!driver) throw new Error("driver did not build");
    return { driver, camera, tracks, phases, worker: () => FakeWorker.built[0], get unavailable() { return unavailable; } };
  }

  it("puts the main thread's track on the wire before the worker has said anything", async () => {
    // The property the whole inverted ordering exists for: there is no moment
    // where the room has nothing to send.
    const h = await build();
    expect(h.tracks).toHaveLength(1);
    expect(h.tracks[0]).toBe(captured[0] as unknown as MediaStreamTrack);
    expect(h.driver.track).toBe(captured[0] as unknown as MediaStreamTrack);
    h.driver.destroy();
  });

  it("hands the worker a clone, and never the camera the room is built on", async () => {
    const h = await build();
    expect(h.camera.clones).toHaveLength(1);
    expect(h.camera.stopped).toBe(0);
    const start = h.worker().sent.find((m) => m.kind === "start-streams");
    expect(start).toBeTruthy();
    // Chrome's route transfers the stream halves, not the track.
    expect(h.worker().transfers[0]).toEqual([{ kind: "readable" }, { kind: "writable" }]);
    h.driver.destroy();
  });

  it("does not move the room when the worker says it is ready", async () => {
    // `ready` means the pipeline was built, which is exactly the state that can
    // still emit nothing. Acting on it is how the black tile ships.
    const h = await build();
    h.worker().emit({ kind: "ready", protocol: "transfer-streams", track: null });
    expect(h.tracks).toHaveLength(1);
    expect(h.phases).not.toContain("worker");
    h.driver.destroy();
  });

  it("moves the room on a real frame, and only once", async () => {
    const h = await build();
    h.worker().emit({ kind: "ready", protocol: "transfer-streams", track: null });
    h.worker().emit({ kind: "frame", index: 0 });
    expect(h.tracks).toHaveLength(2);
    expect(h.phases).toContain("worker");
    // The main pipeline is released on adoption — that is the saving, and its
    // dead output track is what proves it happened. Asserted as state rather
    // than a call count: `destroy` stops the track and drains the stream, and
    // this fake answers both with the same object.
    expect(captured[0].readyState).toBe("ended");

    h.worker().emit({ kind: "frame", index: 1 });
    h.worker().emit({ kind: "frame", index: 2 });
    expect(h.tracks).toHaveLength(2);
    h.driver.destroy();
  });

  it("gives the room a main-thread track again BEFORE tearing down a worker it was watching", async () => {
    const h = await build();
    h.worker().emit({ kind: "ready", protocol: "transfer-streams", track: null });
    h.worker().emit({ kind: "frame", index: 0 });
    const worker = h.worker();
    expect(worker.terminated).toBe(0);

    h.worker().emit({ kind: "failed", reason: "writer closed" });
    await flush();

    // A third track: the rebuilt main pipeline. And it has to arrive BEFORE the
    // terminate -- the end state is identical either way, so only the order
    // distinguishes "the room was moved to safety" from "the room spent a
    // second pointed at a dead track".
    expect(h.tracks).toHaveLength(3);
    expect(worker.terminated).toBe(1);
    expect(FakeWorker.log).toEqual(["track", "track", "track", "terminate"]);
    expect(h.driver.track).toBe(h.tracks[2]);
    h.driver.destroy();
  });

  it("gives up on a worker that takes the track and goes quiet", async () => {
    const h = await build();
    const worker = h.worker();
    clock += FIRST_FRAME_DEADLINE_MS;
    jest.advanceTimersByTime(1_000);
    await flush();

    expect(worker.terminated).toBe(1);
    expect(worker.kinds()).toContain("stop");
    // The room never moved: zero track changes on the unhappy path.
    expect(h.tracks).toHaveLength(1);
    expect(h.driver.phase).toEqual({ phase: "main", reason: "no-first-frame" });
    h.driver.destroy();
  });

  it("does not charge a paused worker for the silence it was ordered into", async () => {
    // The defect this test was written for, end to end. A member joins with
    // their camera off and a remembered background: nothing is composited,
    // nothing is sent, and the worker correctly emits no frames. A clock left
    // running convicts it anyway, and the latch makes that permanent.
    const h = await build({ paused: true });
    const worker = h.worker();

    clock += FIRST_FRAME_DEADLINE_MS * 4;
    jest.advanceTimersByTime(10_000);
    await flush();
    expect(worker.terminated).toBe(0);
    expect(h.driver.phase).toMatchObject({ phase: "trying" });

    // Camera on. The clock starts from here, so a frame that arrives promptly
    // is still in time.
    h.driver.setPaused(false);
    await flush();
    clock += 100;
    jest.advanceTimersByTime(250);
    await flush();
    worker.emit({ kind: "frame", index: 0 });
    expect(h.tracks).toHaveLength(2);
    expect(h.driver.phase).toMatchObject({ phase: "worker" });
    h.driver.destroy();
  });

  it("tells the worker to release its segmenter before terminating it", async () => {
    const h = await build();
    const worker = h.worker();
    h.driver.destroy();
    expect(worker.kinds()).toContain("stop");
    expect(worker.terminated).toBe(1);
    // The camera clone is this driver's to stop; the camera itself is not.
    expect(h.camera.clones[0].stopped).toBe(1);
    expect(h.camera.stopped).toBe(0);
  });

  it("re-points at a new camera without building a second worker", async () => {
    const h = await build();
    h.worker().emit({ kind: "frame", index: 0 });
    expect(h.tracks).toHaveLength(2);

    const next = new FakeTrack("camera-2");
    await h.driver.replaceSource(next as unknown as MediaStreamTrack);
    // The room goes back to a main-thread composite on the new camera, and the
    // worker gets a fresh attempt on a clone of it.
    expect(h.tracks.length).toBeGreaterThanOrEqual(3);
    expect(next.clones).toHaveLength(1);
    expect(FakeWorker.built).toHaveLength(1);
    // And the clone the old attempt was consuming is stopped. Nothing else can
    // stop it: the room never saw it, and a camera tap left running is a
    // camera light that stays on.
    expect(h.camera.clones[0].stopped).toBeGreaterThanOrEqual(1);
    h.driver.destroy();
  });

  it("never attempts the worker again once the main thread has won", async () => {
    // The latch, which is the only reason this is a driver rather than a
    // processor: a browser where the worker does not work must pay one deadline
    // for the call, not one per camera change.
    const h = await build();
    clock += FIRST_FRAME_DEADLINE_MS;
    jest.advanceTimersByTime(1_000);
    await flush();
    expect(h.driver.phase).toMatchObject({ phase: "main" });

    const next = new FakeTrack("camera-2");
    await h.driver.replaceSource(next as unknown as MediaStreamTrack);
    expect(FakeWorker.built).toHaveLength(1);
    expect(next.clones).toHaveLength(0);
    expect(h.driver.phase).toMatchObject({ phase: "main", reason: "no-first-frame" });
    h.driver.destroy();
  });

  it("transfers the camera itself on the standardised route", async () => {
    // The browser family the probe exists for: neither insertable-streams half
    // is on this thread, so the worker has to report before anything can be
    // routed, and then the TRACK travels rather than the streams.
    delete scope.MediaStreamTrackProcessor;
    delete scope.MediaStreamTrackGenerator;
    const h = await build();

    // Nothing handed over yet, but the worker exists to be asked.
    expect(h.driver.phase).toMatchObject({ phase: "probing" });
    expect(FakeWorker.built).toHaveLength(1);
    expect(h.camera.clones).toHaveLength(0);

    h.worker().emit({ kind: "support", support: WORKER_SUPPORT });
    await flush();
    expect(h.driver.phase).toMatchObject({ phase: "trying", protocol: "transfer-track" });
    expect(h.camera.clones).toHaveLength(1);
    const start = h.worker().sent.find((m) => m.kind === "start-track");
    expect(start).toBeTruthy();
    expect(h.worker().transfers[h.worker().sent.indexOf(start!)]).toEqual([h.camera.clones[0]]);

    // And the output track comes back the other way.
    const outbound = new FakeTrack("worker-out");
    h.worker().emit({ kind: "ready", protocol: "transfer-track", track: outbound });
    h.worker().emit({ kind: "frame", index: 0 });
    expect(h.tracks[1]).toBe(outbound as unknown as MediaStreamTrack);
    h.driver.destroy();
  });

  it("refuses to adopt a frame when no output track ever arrived", async () => {
    // Not a state a working worker reaches, which is exactly why it is pinned:
    // the rule is that the room is never pointed at nothing, and a `?? camera`
    // written here in a hurry would send the unmasked room instead.
    delete scope.MediaStreamTrackProcessor;
    delete scope.MediaStreamTrackGenerator;
    const h = await build();
    h.worker().emit({ kind: "support", support: WORKER_SUPPORT });
    await flush();
    const worker = h.worker();

    // A frame, but `ready` never carried a track back.
    worker.emit({ kind: "frame", index: 0 });
    await flush();

    // The room ends on a live main-thread track and the worker is gone. It gets
    // there via a rebuild rather than by simply staying put, because the
    // reducer has already recorded the adoption by the time the shell discovers
    // there is nothing to adopt -- so this is handled as a worker that failed
    // after adoption, which is the one case that has to move the room BACK. One
    // wasted main-pipeline build on a path a working worker cannot reach is the
    // right price for not having a second recovery route to get wrong.
    expect(h.tracks).toHaveLength(2);
    expect(h.driver.track).toBe(captured[1] as unknown as MediaStreamTrack);
    expect(captured[1].readyState).toBe("live");
    expect(h.driver.phase).toEqual({ phase: "main", reason: "worker-failed" });
    expect(worker.terminated).toBe(1);
    // The worker is terminated BEFORE the rebuilt track arrives, and that is
    // right: the room never actually moved onto the worker's output, so there
    // was nothing to protect and nothing to wait for. The wait exists for the
    // case above, where the room WAS watching the worker -- and the flag that
    // distinguishes them is the one that was never set here.
    expect(FakeWorker.log).toEqual(["track", "terminate", "track"]);
    h.driver.destroy();
  });

  it("gives up on a worker that never says what it can do", async () => {
    delete scope.MediaStreamTrackProcessor;
    delete scope.MediaStreamTrackGenerator;
    const h = await build();
    const worker = h.worker();

    clock += FIRST_FRAME_DEADLINE_MS;
    jest.advanceTimersByTime(1_000);
    await flush();

    expect(worker.terminated).toBe(1);
    expect(h.driver.phase).toEqual({ phase: "main", reason: "worker-not-probed" });
    expect(h.tracks).toHaveLength(1);
    h.driver.destroy();
  });

  it("stays on the main thread, with no worker at all, where there are none", async () => {
    delete scope.Worker;
    const h = await build();
    expect(FakeWorker.built).toHaveLength(0);
    expect(h.tracks).toHaveLength(1);
    expect(h.driver.phase).toEqual({ phase: "main", reason: "no-worker" });
    h.driver.destroy();
  });

  it("forwards a background change to whichever pipeline is live", async () => {
    const h = await build();
    h.driver.setEffect({ kind: "template", id: "neural" });
    expect(h.worker().kinds()).toContain("effect");
    h.driver.destroy();
  });

  it("stops talking to a worker it has already given up on", async () => {
    const h = await build();
    clock += FIRST_FRAME_DEADLINE_MS;
    jest.advanceTimersByTime(1_000);
    await flush();
    const before = h.worker().sent.length;

    h.driver.setEffect({ kind: "template", id: "terminal" });
    h.driver.setPaused(true);
    expect(h.worker().sent).toHaveLength(before);
    h.driver.destroy();
  });

  it("reports the worker's timing through to the caller", async () => {
    const reports: unknown[] = [];
    const camera = new FakeTrack();
    const driver = await MaskDriver.create(
      camera as unknown as MediaStreamTrack,
      { kind: "blur", strength: "light" },
      {
        onTrack: () => {},
        onSlowFrames: () => {},
        onUnavailable: () => {},
        onStats: (r) => { reports.push(r); },
      },
    );
    if (!driver) throw new Error("driver did not build");
    const stats = { frames: 24, readbackMsPerFrame: 2.1, chainMsPerFrame: 3.4, totalMsPerFrame: 7.2, worstTotalMs: 19 };
    FakeWorker.built[0].emit({ kind: "stats", stats });
    expect(reports).toEqual([stats]);
    driver.destroy();
  });
});
