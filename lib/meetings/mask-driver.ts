// lib/meetings/mask-driver.ts
// The one file that owns a real Worker, and therefore decides nothing.
//
// Every ordering question this answers is answered in `mask-driver-state.ts`,
// where a test can ask it. This is the interpreter: it builds what the reducer
// asks for, reports what happens back as events, and holds the handles that have
// to be released. The split is deliberate and it is a response to #1249, where
// five of six real defects were in the untestable entry rather than the tested
// modules beneath it.
//
// ── Why this outlives the tracks it composites ───────────────────────────────
//
// `BackgroundProcessor` is bound to the track it was built from, so the room
// rebuilds it whenever the camera device changes or the member passes back
// through "no background". A driver with that lifetime would be useless: the
// fallback latch is the thing that stops a browser where the worker does not
// work from paying another first-frame deadline, and a latch that resets every
// time somebody toggles their background latches nothing.
//
// So this owns the processor rather than being one. `replaceSource` re-attempts
// on a new camera and `setEffect` changes the background, both without
// rebuilding the driver, and the latch lasts as long as the call.
//
// ── What the room has to do differently ─────────────────────────────────────
//
// One thing: the output track changes. `BackgroundProcessor.track` is fixed for
// the life of the processor, and here it is not -- the room starts on the main
// thread's track and moves to the worker's a beat later. `onTrack` fires on
// every change including the first, and the room replaces its outgoing video
// with whatever it is handed.

import {
  driverAwaitingWorker,
  driverNeedsWorker,
  driverStep,
  initialDriverState,
  type DriverAction,
  type DriverEvent,
  type DriverPhase,
  type DriverState,
} from "@/lib/meetings/mask-driver-state";
import { readPipelineSupport } from "@/lib/meetings/mask-pipeline";
import type { PipelineProtocol } from "@/lib/meetings/mask-pipeline";
import type { MainToWorker, TimingReport, WorkerToMain } from "@/lib/meetings/mask-worker-protocol";
import type { BackgroundEffect } from "@/lib/meetings/backgrounds";
import type { BackgroundProcessor } from "@/lib/meetings/background-processor";

/**
 * How often the first-frame deadline is checked.
 *
 * A poll rather than a `setTimeout` per attempt, because the deadline has to be
 * re-armed on every hand-over and cancelled on every outcome, and a single
 * interval that asks the reducer "has it run out" cannot be left dangling by a
 * path that forgot to clear it. 250ms costs nothing and bounds the overshoot at
 * a tenth of the deadline.
 */
const TICK_MS = 250;

export interface MaskDriverCallbacks {
  /**
   * The track the room should be sending, now.
   *
   * Fires for the main thread's track at startup and again if the worker is
   * adopted, so the room's handler has to be idempotent and has to be prepared
   * to be called twice within a few seconds of joining.
   */
  onTrack: (track: MediaStreamTrack) => void;
  /** Sustained slow frames on the MAIN pipeline, where the room's budget is. */
  onSlowFrames: (consecutive: number) => void;
  /** Nothing could be built at all; there is no masking on this browser. */
  onUnavailable: () => void;
  /** Where the work ended up, every time that changes. */
  onPhase?: (phase: DriverPhase) => void;
  /** The worker's own timing, about once a second while it is compositing. */
  onStats?: (report: TimingReport) => void;
}

export class MaskDriver {
  private state: DriverState = initialDriverState();
  private source: MediaStreamTrack;
  private effect: BackgroundEffect;
  private image: Blob | null = null;

  private processor: BackgroundProcessor | null = null;
  /** The main build in flight, so the paths that need it finished can wait. */
  private mainReady: Promise<boolean> | null = null;

  private worker: Worker | null = null;
  private workerTrack: MediaStreamTrack | null = null;
  /** The camera clone the worker is consuming, which only this can stop. */
  private clone: MediaStreamTrack | null = null;
  /**
   * A worker track the room was still watching when its attempt ended.
   *
   * Kept rather than stopped, and stopped as soon as the main thread's track has
   * replaced it. Stopping it at once would black the tile out; dropping the
   * reference would leak a track nobody can stop.
   */
  private stranded: MediaStreamTrack | null = null;

  private ticker: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private paused = false;
  /** Whether the track the room is sending came from the worker. */
  private liveIsWorker = false;
  private liveTrack: MediaStreamTrack | null = null;
  /** Supersedes a bitmap decode still in flight when the choice moves on. */
  private imageToken = 0;

  private constructor(
    source: MediaStreamTrack,
    effect: BackgroundEffect,
    image: Blob | null,
    private readonly callbacks: MaskDriverCallbacks,
  ) {
    this.source = source;
    this.effect = effect;
    this.image = image;
  }

  /**
   * Build a driver and get the room onto a composited track.
   *
   * Resolves null on the same condition `BackgroundProcessor.create` does --
   * nothing could be built -- so the room's existing handling of that is
   * unchanged. It does NOT wait for the worker: the whole design is that the
   * room starts on the main thread and the worker catches up or does not.
   */
  static async create(
    source: MediaStreamTrack,
    effect: BackgroundEffect,
    callbacks: MaskDriverCallbacks,
    image: Blob | null = null,
  ): Promise<MaskDriver | null> {
    const driver = new MaskDriver(source, effect, image, callbacks);
    await driver.dispatch({ kind: "begin", main: scopeSupport(), nowMs: now() });
    // The main build is started, not awaited, by `apply` -- so it has to be
    // waited for here. Without this the driver would report failure on every
    // browser, because nothing has had a chance to finish yet.
    const started = await driver.mainSettled();
    if (!started) { driver.destroy(); return null; }
    return driver;
  }

  /** The track the room should be sending, or null before anything is built. */
  get track(): MediaStreamTrack | null {
    return this.liveTrack;
  }

  /** Where the work ended up. */
  get phase(): DriverPhase {
    return this.state.phase;
  }

  /**
   * Change the background.
   *
   * Sent to both pipelines unconditionally, because either may be the one
   * feeding the room and this must not depend on getting that right. A pipeline
   * that is not running ignores it; the worker closes a bitmap it cannot use.
   */
  setEffect(effect: BackgroundEffect, image: Blob | null = null): void {
    if (this.destroyed) return;
    this.effect = effect;
    this.image = image;
    this.imageToken += 1;
    this.processor?.setEffect(effect, image);
    this.post({ kind: "effect", effect, image: null });
    if (effect.kind === "custom" && image) void this.sendBitmap(image, this.imageToken);
  }

  /** Stop compositing while the camera is off, and resume when it comes back. */
  setPaused(paused: boolean): void {
    if (this.destroyed) return;
    this.paused = paused;
    this.processor?.setPaused(paused);
    this.post({ kind: "pause", paused });
  }

  /**
   * Adopt a newly opened camera.
   *
   * The reducer's `restart`: the main pipeline is rebuilt on the new track and,
   * unless the latch is down, the worker gets a fresh attempt. The latch is what
   * makes this cheap on a browser where the worker does not work -- that member
   * pays one deadline for the call, not one per camera change.
   */
  async replaceSource(source: MediaStreamTrack): Promise<boolean> {
    if (this.destroyed) return false;
    this.source = source;
    await this.dispatch({ kind: "restart", main: scopeSupport(), nowMs: now() });
    return this.mainSettled();
  }

  /** Release the worker, the processor, the clone and the output tracks. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopTicker();
    // Cleared first so `releaseAttempt` stops the worker's track instead of
    // sparing it as the one the room is watching. There is no room any more.
    this.liveIsWorker = false;
    this.liveTrack = null;
    this.teardownWorker();
    this.stopStranded();
    this.processor?.destroy();
    this.processor = null;
    this.mainReady = null;
  }

  // ── events in, actions out ────────────────────────────────────────────────

  /** Feed one event to the reducer and carry out what it asks for. */
  private async dispatch(event: DriverEvent): Promise<void> {
    if (this.destroyed) return;
    const before = this.state.phase;
    const step = driverStep(this.state, event);
    this.state = step.state;
    if (step.state.phase !== before) this.callbacks.onPhase?.(step.state.phase);
    await this.apply(step.actions);
    this.syncTicker();
  }

  /**
   * Carry out the reducer's actions, in the order it gave them.
   *
   * `start-main` is STARTED rather than awaited, and its promise kept. Awaiting
   * it inline would delay a hand-over in the same batch behind a 12MB segmenter
   * download, and the reducer has already started the first-frame clock -- the
   * worker would be judged on a deadline it spent waiting for an unrelated
   * build. The two are independent, so they run at once.
   *
   * `stop-worker` is the one action that needs the main build finished, and only
   * when the room is watching the worker's track. That is the case the reducer
   * emits `start-main` first for.
   *
   * A failure discovered while building is reported AFTER the loop rather than
   * from inside it. Dispatching re-entrantly would advance the state machine
   * underneath an action list that was derived from the old state.
   */
  private async apply(actions: DriverAction[]): Promise<void> {
    let failure: string | null = null;
    for (const action of actions) {
      switch (action.kind) {
        case "start-main":
          this.mainReady = this.startMain();
          break;
        case "probe-worker":
          if (!this.ensureWorker()) failure ??= "worker-construction-failed";
          break;
        case "hand-over":
          failure ??= this.handOver(action.protocol);
          break;
        case "adopt-worker":
          failure ??= this.adoptWorker();
          break;
        case "stop-worker":
          if (this.liveIsWorker) await this.mainSettled();
          this.teardownWorker();
          break;
      }
    }
    if (failure) await this.dispatch({ kind: "worker-failed", reason: failure });
  }

  // ── the main pipeline ─────────────────────────────────────────────────────

  /** Whether the main pipeline is up. Null before anything was asked of it. */
  private async mainSettled(): Promise<boolean> {
    return (await this.mainReady) ?? false;
  }

  /**
   * Build the main-thread processor on the current camera and give the room its
   * track.
   *
   * Imported dynamically for the same reason the room imports it that way: the
   * segmenter and the per-pixel chain have no business in the bundle of a member
   * who never turns a background on.
   */
  private async startMain(): Promise<boolean> {
    const previous = this.processor;
    const hadTrack = this.liveTrack !== null;
    this.processor = null;
    let built: BackgroundProcessor | null = null;
    try {
      const mod = await import("@/lib/meetings/background-processor");
      built = await mod.BackgroundProcessor.create(this.source, {
        // Once the worker is carrying the frames, a slow main-thread frame is
        // not the room's problem any more -- and the processor reporting it is
        // about to be destroyed anyway.
        onSlowFrames: (n) => { if (!this.liveIsWorker) this.callbacks.onSlowFrames(n); },
        onUnavailable: () => this.callbacks.onUnavailable(),
      });
    } catch (err) {
      // Swallowed rather than propagated for the reason the room swallows it: a
      // canvas or a WASM loader that throws instead of returning null is still
      // just a failure to build, and letting it escape here would leave the
      // driver half-constructed with the camera held off the wire.
      console.warn("[mask-driver] main pipeline failed to build", err);
    }
    // Destroyed only after the replacement exists, so a restart never has no
    // pipeline at all.
    previous?.destroy();
    if (!built || this.destroyed) {
      built?.destroy();
      // On the way up, returning false is the whole signal and `create` turns it
      // into a null the room already handles. Once the driver is running, there
      // is nobody checking a return value: this is the member who was watching
      // the worker when it broke, and the main thread could not take over.
      if (hadTrack && !this.destroyed) this.callbacks.onUnavailable();
      return false;
    }

    this.processor = built;
    built.setEffect(this.effect, this.image);
    if (this.paused) built.setPaused(true);
    this.liveIsWorker = false;
    this.liveTrack = built.track;
    this.callbacks.onTrack(built.track);
    // The room is off the worker's old track now, so it can finally be stopped.
    this.stopStranded();
    return true;
  }

  // ── the worker ────────────────────────────────────────────────────────────

  /**
   * Hand the worker a clone of the camera, under the protocol it was routed to.
   *
   * A CLONE because the main pipeline is still reading the original and
   * `MediaStreamTrackProcessor` is a consuming sink. Under `transfer-track` the
   * clone is transferred away and neutered here, which is exactly why it must
   * not be the track the room is built on.
   *
   * Returns a failure reason rather than reporting one, so the caller decides
   * when the state machine hears about it.
   */
  private handOver(protocol: PipelineProtocol): string | null {
    this.releaseAttempt();
    const worker = this.ensureWorker();
    if (!worker) return "worker-construction-failed";

    const settings = this.source.getSettings();
    const width = settings.width ?? 1280;
    const height = settings.height ?? 720;

    let clone: MediaStreamTrack;
    try {
      clone = this.source.clone();
    } catch (err) {
      console.warn("[mask-driver] camera clone refused", err);
      return "clone-failed";
    }
    this.clone = clone;

    try {
      if (protocol === "transfer-track") {
        worker.postMessage(
          { kind: "start-track", track: clone, width, height, effect: this.effect },
          [clone as unknown as Transferable],
        );
      } else {
        const halves = buildStreamHalves(clone);
        if (!halves) throw new Error("insertable streams absent on the main thread");
        worker.postMessage(
          { kind: "start-streams", readable: halves.readable, writable: halves.writable, width, height, effect: this.effect },
          [halves.readable as Transferable, halves.writable as Transferable],
        );
        // Available immediately on this route, but deliberately not adopted: a
        // generator with a track is precisely the state that can still emit
        // nothing. Only a frame moves the room.
        this.workerTrack = halves.track;
      }
    } catch (err) {
      console.warn("[mask-driver] hand-over failed", err);
      return "hand-over-failed";
    }
    // The start messages carry no image, so a custom background has to follow as
    // its own `effect` message once the session exists.
    if (this.effect.kind === "custom" && this.image) void this.sendBitmap(this.image, this.imageToken);
    if (this.paused) this.post({ kind: "pause", paused: true });
    return null;
  }

  /** Move the room onto the worker's output and let the main pipeline go. */
  private adoptWorker(): string | null {
    const track = this.workerTrack;
    // A frame without a track is not a state the worker can reach; if it ever
    // does, the room stays where it is rather than being pointed at nothing.
    if (!track) return "adopted-without-track";

    this.liveIsWorker = true;
    this.liveTrack = track;
    this.callbacks.onTrack(track);
    // The saving is the point: this releases the main thread's WebGL context,
    // its <video> decoding the camera, and its hold on the 12MB segmenter.
    //
    // The cost, stated plainly because it is a real one: recovering from a LATER
    // worker failure has to rebuild all of that, which takes seconds rather than
    // a frame. During those seconds the room keeps sending the worker's last
    // composited frame rather than the raw camera -- a frozen face is a far
    // better failure than broadcasting the room somebody chose a background to
    // hide. Keeping the main pipeline alive instead would make that recovery
    // instant and would also spend, for every second of every call, most of what
    // this work exists to save.
    this.processor?.destroy();
    this.processor = null;
    this.mainReady = null;
    return null;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.destroyed) return null;
    try {
      // No `{ type: "module" }`: webpack compiles that option away and emits a
      // CLASSIC worker that loads its further chunks with `importScripts`, so
      // claiming a module worker here would describe something that does not
      // exist at runtime. Static imports inside the worker are fine either way.
      const worker = new Worker(new URL("./mask-worker.ts", import.meta.url));
      worker.onmessage = (event: MessageEvent) => this.onWorkerMessage(event.data);
      worker.onerror = (event) => {
        void this.dispatch({ kind: "worker-failed", reason: event.message || "worker error" });
      };
      this.worker = worker;
      return worker;
    } catch (err) {
      console.warn("[mask-driver] worker could not be constructed", err);
      return null;
    }
  }

  private onWorkerMessage(data: unknown): void {
    if (this.destroyed) return;
    if (typeof data !== "object" || data === null) return;
    const message = data as WorkerToMain;
    switch (message.kind) {
      case "support":
        void this.dispatch({
          kind: "worker-support",
          main: scopeSupport(),
          support: message.support,
          nowMs: now(),
        });
        break;
      case "ready":
        // Only `transfer-track` sends a track back; under `transfer-streams` the
        // generator was built here and its track is already held.
        if (message.track) this.workerTrack = message.track as MediaStreamTrack;
        void this.dispatch({ kind: "worker-ready", protocol: message.protocol });
        break;
      case "frame":
        void this.dispatch({ kind: "worker-frame" });
        break;
      case "stats":
        this.callbacks.onStats?.(message.stats);
        break;
      case "failed":
        void this.dispatch({ kind: "worker-failed", reason: message.reason });
        break;
    }
  }

  private post(message: MainToWorker, transfer: Transferable[] = []): void {
    if (!this.worker || !driverNeedsWorker(this.state)) return;
    try {
      this.worker.postMessage(message, transfer);
    } catch (err) {
      console.warn("[mask-driver] postMessage failed", err);
    }
  }

  /**
   * Decode a custom background and transfer it in.
   *
   * Token-checked against the current choice for the reason the main processor
   * checks its own: a decode is long enough for somebody to change their mind
   * twice, and the loser must not win.
   */
  private async sendBitmap(blob: Blob, token: number): Promise<void> {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (err) {
      console.warn("[mask-driver] background image could not be decoded", err);
      return;
    }
    if (this.destroyed || token !== this.imageToken || !this.worker || !driverNeedsWorker(this.state)) {
      // Nobody is going to take ownership of it, so it is closed here. A leaked
      // ImageBitmap is a frame buffer held for the rest of the call.
      try { bitmap.close(); } catch { /* already closed */ }
      return;
    }
    this.post({ kind: "effect", effect: this.effect, image: bitmap }, [bitmap]);
  }

  /** Release what one attempt owns, leaving the worker itself alone. */
  private releaseAttempt(): void {
    const track = this.workerTrack;
    this.workerTrack = null;
    if (track && track === this.liveTrack) {
      // The room is still watching it. Held until the main thread's track takes
      // over rather than stopped now, which would black the tile out.
      this.stopStranded();
      this.stranded = track;
    } else if (track) {
      try { track.stop(); } catch { /* already stopped */ }
    }
    if (this.clone) {
      try { this.clone.stop(); } catch { /* already stopped, or transferred */ }
      this.clone = null;
    }
  }

  private stopStranded(): void {
    if (!this.stranded) return;
    try { this.stranded.stop(); } catch { /* already stopped */ }
    this.stranded = null;
  }

  private teardownWorker(): void {
    const worker = this.worker;
    this.worker = null;
    this.releaseAttempt();
    if (!worker) return;
    try {
      // Asked to close its segmenter and surfaces before being terminated, so
      // the WebGL context is handed back rather than collected whenever the
      // browser gets round to it.
      worker.postMessage({ kind: "stop" } satisfies MainToWorker);
    } catch { /* already gone */ }
    worker.onmessage = null;
    worker.onerror = null;
    try { worker.terminate(); } catch { /* already terminated */ }
  }

  // ── the deadline ──────────────────────────────────────────────────────────

  private syncTicker(): void {
    // On the clock, not merely needing the worker: once a frame has arrived the
    // deadline no longer applies, and polling on for the rest of the call would
    // be main-thread work spent to no end.
    if (driverAwaitingWorker(this.state) && !this.destroyed) this.startTicker();
    else this.stopTicker();
  }

  private startTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => { void this.dispatch({ kind: "tick", nowMs: now() }); }, TICK_MS);
  }

  private stopTicker(): void {
    if (!this.ticker) return;
    clearInterval(this.ticker);
    this.ticker = null;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function scopeSupport() {
  return readPipelineSupport(globalThis as unknown as Record<string, unknown>);
}

/** The pre-standard pair, built on the main thread under `transfer-streams`. */
interface StreamHalves {
  readable: unknown;
  writable: unknown;
  track: MediaStreamTrack;
}

/**
 * Build Chrome's pre-standard pair on the main thread.
 *
 * Reached off `globalThis` rather than imported, because neither constructor is
 * in the DOM lib and both are absent on the browsers that implement only the
 * standard -- which is the whole reason the route is decided from two snapshots
 * rather than one.
 */
function buildStreamHalves(track: MediaStreamTrack): StreamHalves | null {
  const scope = globalThis as unknown as Record<string, unknown>;
  const Processor = scope.MediaStreamTrackProcessor as
    | (new (init: { track: MediaStreamTrack }) => { readable: unknown })
    | undefined;
  const Generator = scope.MediaStreamTrackGenerator as
    | (new (init: { kind: "video" }) => { writable: unknown; track: MediaStreamTrack })
    | undefined;
  if (typeof Processor !== "function" || typeof Generator !== "function") return null;
  const processor = new Processor({ track });
  const generator = new Generator({ kind: "video" });
  return { readable: processor.readable, writable: generator.writable, track: generator.track };
}
