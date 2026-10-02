// lib/meetings/mask-worker.ts
// The masking worker's entry point: wiring, and nothing that can be decided.
//
// This is the one file in the pipeline that cannot be executed in a test -- it
// needs a real `Worker` scope, a real `OffscreenCanvas` with a GPU behind it,
// real `VideoFrame`s and MediaPipe's 12MB WASM runtime. So everything that
// could be moved out of it has been: the per-frame decisions are in
// `mask-worker-core.ts`, the chain is in `mask-compositor.ts`, the routing rules
// are in `mask-pipeline.ts`, and the message shapes are in
// `mask-worker-protocol.ts`, all of them tested. What is left here is the part
// where this file says which real object goes in which slot.
//
// Read the three browser facts it is built on, because each one is a black tile
// if it is wrong.
//
// It is bundled as a CLASSIC worker. `new Worker(new URL(...), { type: "module" })`
// compiles down to a classic worker with the `type` dropped, and further chunks
// arrive by `importScripts`. Static `import` at the top of this file is fine --
// the bundler resolves it before the browser ever sees it -- but anything that
// assumes an ES module scope at runtime is not.
//
// The two insertable-streams protocols differ by WHERE the halves are built,
// not by name. Under `transfer-streams` the main thread owns both and sends a
// `readable` and a `writable`; under `transfer-track` the camera track arrives
// and this file builds the processor and a `VideoTrackGenerator`, whose
// `.track` goes back. Compositing happens here under both, which is why
// `pipelineRoute` checks this scope's `OffscreenCanvas` rather than the main
// thread's.
//
// And these APIs fail by producing nothing. Nothing here throws when a browser
// quietly declines; the main thread's `FIRST_FRAME_DEADLINE_MS` is what notices,
// and the `frame` messages below are the only thing that stops it firing.

import {
  MaskCompositor,
  offscreenSurfaceFactory,
  type MaskSample,
  type Surface2D,
} from "@/lib/meetings/mask-compositor";
import { readPipelineSupport } from "@/lib/meetings/mask-pipeline";
import { MaskFrameLoop, type IncomingFrame } from "@/lib/meetings/mask-worker-core";
import type { MainToWorker, WorkerToMain } from "@/lib/meetings/mask-worker-protocol";
import type { BackgroundEffect } from "@/lib/meetings/backgrounds";

const WASM_PATH = "/mediapipe";
const MODEL_PATH = "/mediapipe/selfie_segmenter.tflite";

/**
 * The worker's own global, typed for the handful of things used here.
 *
 * Declared locally rather than by adding `webworker` to the project's `lib`:
 * that lib REPLACES the DOM one, and every other file in the app is written
 * against the DOM. A six-line interface is the smaller cost.
 */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = self as unknown as WorkerScope;

interface CategoryMask { width?: number; height?: number; getAsUint8Array: () => Uint8Array; close: () => void }
interface ConfidenceMask { width?: number; height?: number; getAsFloat32Array: () => Float32Array; close: () => void }
interface SegmentResult { categoryMask?: CategoryMask; confidenceMasks?: ConfidenceMask[] }

type Segmenter = {
  segmentForVideo: (
    frame: Surface2D,
    timestampMs: number,
    callback: (result: SegmentResult) => void,
  ) => void;
  close: () => void;
};

function post(message: WorkerToMain, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

/**
 * Turn what MediaPipe handed back into the plain arrays the chain takes.
 *
 * The same reading as on the main thread, deliberately not shared with it:
 * importing `background-processor.ts` here would pull a `document`-dependent
 * module into a scope that has none, and the bundler would not complain until
 * the worker ran. Twenty lines duplicated against that is the better trade --
 * and unlike the chain itself, this has no behaviour to drift.
 */
function readMaskSample(result: SegmentResult): MaskSample | null {
  const confidence = result.confidenceMasks?.[0];
  if (confidence) {
    return {
      kind: "confidence",
      data: confidence.getAsFloat32Array(),
      width: confidence.width ?? 0,
      height: confidence.height ?? 0,
    };
  }
  const category = result.categoryMask;
  if (category) {
    return {
      kind: "category",
      data: category.getAsUint8Array(),
      width: category.width ?? 0,
      height: category.height ?? 0,
    };
  }
  return null;
}

function closeMaskResult(result: SegmentResult): void {
  try { result.categoryMask?.close(); } catch { /* already closed */ }
  result.confidenceMasks?.forEach((m) => { try { m.close(); } catch { /* already closed */ } });
}

/** Everything one running pipeline holds, so `stop` can let go of all of it. */
interface Session {
  compositor: MaskCompositor;
  loop: MaskFrameLoop<SegmentResult, VideoFrame>;
  reader: ReadableStreamDefaultReader<VideoFrame>;
  writer: WritableStreamDefaultWriter<VideoFrame>;
  /** Built here on the standard route, so it is this file's to stop. */
  generator: { track?: MediaStreamTrack } | null;
  paused: boolean;
  /** Whether the first delivered frame has been reported. */
  announced: boolean;
}

let session: Session | null = null;
let segmenter: Segmenter | null = null;
let segmenterLoading: Promise<Segmenter | null> | null = null;

/**
 * Load the segmenter, once per worker.
 *
 * Not awaited before the loop starts. The runtime is a 12MB download and the
 * frames are already arriving; a pipeline that waited would hand every peer a
 * black rectangle for the length of it. `MaskFrameLoop` passes the plain camera
 * through until this resolves.
 */
function loadSegmenter(): Promise<Segmenter | null> {
  if (segmenterLoading) return segmenterLoading;
  segmenterLoading = (async () => {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      const made = await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        // Confidence only, as on the main thread: it is what keeps headwear,
        // because it says how sure the model is rather than what it decided,
        // and a hat is exactly where it is unsure.
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
      return made as unknown as Segmenter;
    } catch (err) {
      // Not fatal to the pipeline: the loop keeps passing the camera through,
      // which is better video than a black tile. The main thread decides
      // whether an unmasked worker is worth keeping.
      post({ kind: "failed", reason: `segmenter: ${describe(err)}` });
      segmenterLoading = null;
      return null;
    }
  })();
  return segmenterLoading;
}

/** Pump frames until the readable ends or the session is torn down. */
async function pump(active: Session): Promise<void> {
  for (;;) {
    let result: ReadableStreamReadResult<VideoFrame>;
    try {
      result = await active.reader.read();
    } catch {
      return;
    }
    if (result.done) return;
    const frame = result.value;
    if (session !== active) {
      // Torn down while this frame was in flight. Closing it is not optional:
      // a leaked frame holds a pool slot for the life of the page.
      try { frame.close(); } catch { /* already closed */ }
      return;
    }
    if (active.paused) {
      try { frame.close(); } catch { /* already closed */ }
      continue;
    }
    const delivered = active.loop.handle(frame as unknown as IncomingFrame);
    // Only the FIRST one. All the main thread needs is for its first-frame
    // deadline to stop applying, and a message per frame would be 24
    // postMessages a second onto the thread this whole exercise exists to free
    // -- paying part of the cost back for a number already carried by `stats`.
    if (delivered && !active.announced) {
      active.announced = true;
      post({ kind: "frame", index: active.loop.framesDelivered });
    }
  }
}

function buildLoop(active: Omit<Session, "loop">): MaskFrameLoop<SegmentResult, VideoFrame> {
  return new MaskFrameLoop<SegmentResult, VideoFrame>({
    compositor: active.compositor,
    // Attached later by `setSegmenter`: frames flow before the runtime lands.
    segmenter: null,
    readMask: readMaskSample,
    closeMask: closeMaskResult,
    makeFrame: (surface, init) =>
      new VideoFrame(surface as CanvasImageSource, {
        timestamp: init.timestamp,
        ...(init.duration === undefined ? {} : { duration: init.duration }),
      }),
    deliver: (frame) => {
      // `write` is async and deliberately not awaited: awaiting it would pace
      // the camera to the slowest consumer and queue frames behind it, each one
      // holding a pool slot.
      //
      // Which means the rejection has to be handled here rather than by the
      // loop, and it has to close the frame. A write that rejects did NOT
      // consume its chunk -- the stream was already closed or errored -- so the
      // frame is still this side's, and by then the loop has been told it was
      // accepted and will not close it. That is the quiet pool exhaustion at the
      // end of every call, where the sink goes away while frames are in flight
      // and nobody is looking at the output any more.
      void active.writer.write(frame).catch(() => {
        try { frame.close(); } catch { /* the stream did take it after all */ }
      });
      // True because the frame left this side. A sink that has gone away is
      // reported by the next `read` coming back done, not by this.
      return true;
    },
    closeFrame: (frame) => { try { frame.close(); } catch { /* already closed */ } },
    now: () => performance.now(),
    onStats: (stats) => post({ kind: "stats", stats }),
    onError: (reason) => post({ kind: "failed", reason }),
  });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function teardown(): void {
  const active = session;
  session = null;
  if (!active) return;
  active.loop.stop();
  try { void active.reader.cancel(); } catch { /* already cancelled */ }
  try { void active.writer.close(); } catch { /* already closed */ }
  try { active.generator?.track?.stop(); } catch { /* already stopped */ }
  active.compositor.destroy();
}

async function start(
  message: Extract<MainToWorker, { kind: "start-streams" | "start-track" }>,
): Promise<void> {
  teardown();

  const compositor = MaskCompositor.create(offscreenSurfaceFactory(), message.width, message.height);
  if (!compositor) {
    post({ kind: "failed", reason: "no-offscreen-context" });
    return;
  }
  compositor.setEffect(message.effect, null);

  let readable: ReadableStream<VideoFrame>;
  let writable: WritableStream<VideoFrame>;
  let generator: { track?: MediaStreamTrack } | null = null;

  try {
    if (message.kind === "start-streams") {
      readable = message.readable as ReadableStream<VideoFrame>;
      writable = message.writable as WritableStream<VideoFrame>;
    } else {
      // The standard route. Both constructors are worker-only by design, which
      // is the whole point of the standard: nothing in the real-time media path
      // waits on a busy main thread.
      const g = scope as unknown as {
        MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
        VideoTrackGenerator: new () => { writable: WritableStream<VideoFrame>; track: MediaStreamTrack };
      };
      const processor = new g.MediaStreamTrackProcessor({ track: message.track as MediaStreamTrack });
      const made = new g.VideoTrackGenerator();
      readable = processor.readable;
      writable = made.writable;
      generator = made;
    }
  } catch (err) {
    compositor.destroy();
    post({ kind: "failed", reason: `pipeline: ${describe(err)}` });
    return;
  }

  const base = {
    compositor,
    reader: readable.getReader(),
    writer: writable.getWriter(),
    generator,
    paused: false,
    announced: false,
  };
  const active: Session = { ...base, loop: buildLoop(base) };
  session = active;

  post(
    {
      kind: "ready",
      protocol: message.kind === "start-streams" ? "transfer-streams" : "transfer-track",
      track: generator?.track ?? null,
    },
    generator?.track ? [generator.track as unknown as Transferable] : [],
  );

  // Frames first, segmenter second. The order is the point: see `loadSegmenter`.
  void pump(active);
  void loadSegmenter().then((loaded) => {
    if (!loaded || session !== active) return;
    segmenter = loaded;
    active.loop.setSegmenter(loaded);
  });
}

scope.onmessage = (event: MessageEvent) => {
  const message = event.data as MainToWorker;
  switch (message.kind) {
    case "start-streams":
    case "start-track":
      void start(message);
      return;
    case "effect":
      session?.compositor.setEffect(message.effect as BackgroundEffect, message.image);
      return;
    case "pause":
      if (session) session.paused = message.paused;
      return;
    case "stop":
      teardown();
      try { segmenter?.close(); } catch { /* already closed */ }
      segmenter = null;
      segmenterLoading = null;
      return;
  }
};

// Reported before anything is built, because the route cannot be decided
// without it: on a browser that implements only the standard,
// `MediaStreamTrackProcessor` is absent from `window` and present here.
post({ kind: "support", support: readPipelineSupport(scope as unknown as Record<string, unknown>) });
