// lib/meetings/mask-driver-state.ts
// What the main thread does about the worker, as a pure state machine.
//
// `mask-pipeline.ts` answers "which route is possible". `mask-worker*.ts` is the
// worker that runs the chain. This is the part in between: the order of
// operations on the main thread, written as a reducer so the driver that owns
// the real `Worker` is a dumb interpreter of these decisions rather than the
// place they live.
//
// That split is not symmetry for its own sake. On #1249 six real defects were
// found in that pipeline and five of them were in the ~200 untestable lines of
// the worker's entry, not in the tested modules beneath it. The shell is where
// things go wrong, so the shell should decide as little as possible.
//
// ── The ordering this encodes, and why it is this way round ──────────────────
//
// The obvious design is to pick a route and build one pipeline. It has a failure
// mode nobody should ship: these APIs fail by producing NOTHING, so a worker
// that accepts a track and never emits leaves the member's tile black -- and the
// deadline that catches it is two and a half seconds of a call where nobody can
// see them.
//
// So this does the opposite. The MAIN thread composites first and its track goes
// to the room immediately, because that path works in every browser today. The
// worker is started in parallel on a CLONE of the camera, and the room is moved
// onto its output only when a real composited frame has arrived from it. Which
// gives:
//
//   - no black tile, ever, on any browser
//   - exactly one `replaceTrack` per peer on the happy path, a beat after joining
//   - ZERO track changes on the unhappy path: the fallback is doing nothing,
//     which is the cheapest and least breakable thing a fallback can be
//
// The cost is a couple of seconds of both pipelines running at join, on a
// machine that was about to run the main-thread one anyway. That is the right
// trade against a black rectangle where somebody's face should be.

import {
  pipelineRoute,
  shouldFallBack,
  pipelineFellBack,
  FIRST_FRAME_DEADLINE_MS,
  type PipelineProtocol,
  type PipelineRoute,
  type PipelineSupport,
} from "@/lib/meetings/mask-pipeline";

/** Where the driver has got to. */
export type DriverPhase =
  /** Nothing started yet. */
  | { phase: "idle" }
  /**
   * The main thread is compositing and the worker has been built, but the
   * worker has not said what it can do yet. Chrome skips this: it owns both
   * insertable-streams halves on the main thread, so `pipelineRoute` can decide
   * without waiting.
   *
   * `sinceMs` is when the worker was constructed, because this phase gets the
   * same deadline as `trying` does. A worker whose script 404s never answers at
   * all, and without a clock here that is a `Worker` handle held for the rest of
   * the call and a member who is never counted under any reason.
   */
  | { phase: "probing"; sinceMs: number }
  /**
   * The worker has the track (or the streams) and the main thread is still
   * compositing for the room. Whichever of the two wins, wins here.
   */
  | { phase: "trying"; protocol: PipelineProtocol; sinceMs: number }
  /** The room is on the worker's output. The main pipeline is stopped. */
  | { phase: "worker"; protocol: PipelineProtocol }
  /** The main thread is it, for the life of this driver. */
  | { phase: "main"; reason: DriverStayReason };

/**
 * Why the main thread kept the frame, as a closed set so it can be counted
 * without parsing prose. The `PipelineRoute` reasons are passed through
 * unchanged, including `worker-not-probed`, which is reused for the worker that
 * never answered: it is exactly what happened, and it stays distinguishable in
 * telemetry from a worker that answered, took the track, and emitted nothing.
 */
export type DriverStayReason =
  | PipelineRoute["reason"]
  /** The worker took the track and no frame arrived before the deadline. */
  | "no-first-frame"
  /** The worker said it was broken. */
  | "worker-failed";

export interface DriverState {
  phase: DriverPhase;
  /**
   * Once the main thread has won, it keeps winning for this driver.
   *
   * A ratchet, and `connection.ts` is the cautionary tale: bandwidth adaptation
   * had this exact shape as a BUG, because a call that dropped to audio-only
   * never got video back when the link recovered. The difference is what each
   * reacts to. Bandwidth recovers. A browser that cannot run `VideoTrackGenerator`,
   * or a worker whose WASM is not being served, does not recover mid-call -- so
   * retrying buys nothing and costs another deadline every time the member
   * changes background.
   *
   * Scoped to the driver, so a new call or a reload tries again from scratch.
   */
  fellBack: boolean;
  /**
   * What the worker reported about its own scope, remembered.
   *
   * Not an optimisation. A restart re-runs the routing decision, and on a
   * standard-only browser the answer depends entirely on this snapshot --
   * `pipelineRoute` can only return `worker-not-probed` without it. The worker
   * announces its support once, at startup, so a restart that threw this away
   * would wait for a message that is never coming, miss the deadline, and latch
   * a Safari member onto the main thread for the rest of the call the first time
   * they changed their background.
   *
   * Which is why it is recorded on every `worker-support`, including the ones
   * whose *decision* is ignored as too late: late as a decision is not the same
   * as worthless as information.
   */
  workerSupport: PipelineSupport | null;
}

export type DriverEvent =
  /** The driver is starting. `main` is this scope's capability snapshot. */
  | { kind: "begin"; main: PipelineSupport; nowMs: number }
  /** The worker reported what its own scope can do. */
  | { kind: "worker-support"; main: PipelineSupport; support: PipelineSupport; nowMs: number }
  /** The worker's pipeline is up. Carries the output track on `transfer-track`. */
  | { kind: "worker-ready"; protocol: PipelineProtocol }
  /** A composited frame really reached the worker's sink. */
  | { kind: "worker-frame" }
  /** The worker said something is wrong, or it died. */
  | { kind: "worker-failed"; reason: string }
  /** Time passed; check the first-frame deadline. */
  | { kind: "tick"; nowMs: number }
  /**
   * Compositing stopped or started again, because the camera was switched off
   * or a screen share took the video sender.
   *
   * A transition the deadline has to know about, not a detail of the shell. A
   * paused worker is SUPPOSED to produce nothing, so a clock left running
   * across a pause reports `no-first-frame` for a worker that was never asked
   * for one -- and the latch means that verdict is final. Somebody who joins
   * with their camera off and a remembered background would be held on the
   * main thread for the rest of the call, having never seen a frame of either
   * pipeline.
   */
  | { kind: "paused"; paused: boolean; nowMs: number }
  /** The member's camera changed, so the attempt starts again. */
  | { kind: "restart"; main: PipelineSupport; nowMs: number };

export type DriverAction =
  /**
   * Composite on the main thread and give the room that track NOW. First on
   * every path, because it is the only one that works everywhere.
   */
  | { kind: "start-main" }
  /**
   * Construct the worker and wait for it to say what it can do. No track goes
   * anywhere near it yet.
   *
   * Separate from `hand-over` because on a browser that implements only the
   * standard there is nothing to hand over until the worker has answered, and a
   * shell that inferred "build it" from the phase alone would be one `if` away
   * from never building it on exactly the browsers this feature exists for.
   */
  | { kind: "probe-worker" }
  /**
   * Build this protocol's halves and hand the worker a CLONE of the camera.
   * A clone because the main pipeline is still reading the original, and
   * `MediaStreamTrackProcessor` is a consuming sink.
   */
  | { kind: "hand-over"; protocol: PipelineProtocol; sinceMs: number }
  /** Move the room onto the worker's track and stop the main pipeline. */
  | { kind: "adopt-worker" }
  /** Tear the worker down. The room is already on the main thread's track. */
  | { kind: "stop-worker"; reason: DriverStayReason };

export function initialDriverState(): DriverState {
  return { phase: { phase: "idle" }, fellBack: false, workerSupport: null };
}

/**
 * One event in, the next state and what the driver must do, out.
 *
 * Returns actions rather than performing them, which is the whole point: every
 * ordering question below is answered here, where a test can ask it, instead of
 * inside the one file that needs a real `Worker` to run at all.
 */
export function driverStep(
  state: DriverState,
  event: DriverEvent,
  deadlineMs: number = FIRST_FRAME_DEADLINE_MS,
): { state: DriverState; actions: DriverAction[] } {
  // Recorded before anything is decided, so the decision and the memory cannot
  // disagree about what the worker said.
  const workerSupport = event.kind === "worker-support" ? event.support : state.workerSupport;

  /** Same phase and latch, carrying whatever was just learned. */
  const idle = () => ({ state: { ...state, workerSupport }, actions: [] });
  /** Move to a phase without touching the latch. */
  const go = (phase: DriverPhase, actions: DriverAction[] = []) => ({
    state: { phase, fellBack: state.fellBack, workerSupport },
    actions,
  });
  /** The main thread has won, and the latch goes down. */
  const stay = (reason: DriverStayReason, actions: DriverAction[] = []) => ({
    state: {
      phase: { phase: "main" as const, reason },
      fellBack: pipelineFellBack(state.fellBack, true),
      workerSupport,
    },
    actions,
  });

  switch (event.kind) {
    case "begin":
    case "restart": {
      // The main thread starts regardless, and its track goes to the room
      // before anything is known about the worker.
      const actions: DriverAction[] = [{ kind: "start-main" }];

      // Already decided. The main pipeline restarts on the new camera, and the
      // phase is left exactly as it was -- including the reason this member is
      // being counted under, which is the real one rather than a fresh guess.
      if (state.fellBack) return { state: { ...state, workerSupport }, actions };

      const route = pipelineRoute(event.main, workerSupport);
      if (route.route === "worker" && route.protocol) {
        return go({ phase: "trying", protocol: route.protocol, sinceMs: event.nowMs }, [
          ...actions,
          { kind: "hand-over", protocol: route.protocol, sinceMs: event.nowMs },
        ]);
      }
      // `worker-not-probed` is the only reason worth waiting on: it means this
      // scope cannot answer alone, not that the answer is no. It is also only
      // reachable before the worker has ever reported, so a restart never lands
      // back here once a snapshot has been remembered.
      if (route.reason === "worker-not-probed") {
        return go({ phase: "probing", sinceMs: event.nowMs }, [
          ...actions,
          { kind: "probe-worker" },
        ]);
      }
      return stay(route.reason, [...actions, { kind: "stop-worker", reason: route.reason }]);
    }

    case "worker-support": {
      // Late answers are recorded but not acted on. Once the track has been
      // handed over, or the room is on the worker's output, or the main thread
      // has won, a snapshot arriving now describes a question nobody is asking
      // -- and acting on it would hand the track over twice.
      if (state.fellBack) return idle();
      if (state.phase.phase !== "probing") return idle();

      const route = pipelineRoute(event.main, event.support);
      if (route.route === "worker" && route.protocol) {
        // The clock restarts here rather than carrying on from `probing`,
        // because the first-frame deadline is about the hand-over. Worst case
        // is therefore two deadlines before the main thread is declared the
        // winner -- which costs nothing visible, since the room has been on the
        // main thread's track the whole time.
        return go({ phase: "trying", protocol: route.protocol, sinceMs: event.nowMs }, [
          { kind: "hand-over", protocol: route.protocol, sinceMs: event.nowMs },
        ]);
      }
      return stay(route.reason, [{ kind: "stop-worker", reason: route.reason }]);
    }

    case "worker-ready":
      // Deliberately not a transition. `ready` means the worker built its
      // halves, which is exactly the state that can still produce nothing --
      // and treating it as success is how the black tile ships. Only a frame
      // counts.
      return idle();

    case "worker-frame": {
      if (state.fellBack) return idle();
      // Only from `trying`, which also means the second frame and every frame
      // after it is a no-op: the room is moved once, not once per frame.
      if (state.phase.phase !== "trying") return idle();
      return go({ phase: "worker", protocol: state.phase.protocol }, [{ kind: "adopt-worker" }]);
    }

    case "worker-failed": {
      if (state.phase.phase === "worker") {
        // It was working and then broke. The room is on its track, so this is
        // the one case that has to move BACK -- `start-main` first so the room
        // is never pointed at a dead track.
        return stay("worker-failed", [
          { kind: "start-main" },
          { kind: "stop-worker", reason: "worker-failed" },
        ]);
      }
      if (state.fellBack) return idle();
      return stay("worker-failed", [{ kind: "stop-worker", reason: "worker-failed" }]);
    }

    case "paused": {
      // Resuming re-bases the clock; pausing does not need to stop it, because
      // the shell stops asking. Both waiting phases are re-based together: the
      // worker answers `probing` from its own startup rather than from frames,
      // so its clock would survive a pause, but one rule that cannot be wrong
      // in the direction that strands people beats two that are each right.
      if (event.paused) return idle();
      const phase = state.phase;
      if (phase.phase === "probing") return go({ phase: "probing", sinceMs: event.nowMs });
      if (phase.phase === "trying") {
        return go({ phase: "trying", protocol: phase.protocol, sinceMs: event.nowMs });
      }
      return idle();
    }

    case "tick": {
      const phase = state.phase;
      // Both waiting phases are on the clock. `probing` is waiting for a message
      // and `trying` for a frame, and the silent failure is the same shape.
      if (phase.phase !== "probing" && phase.phase !== "trying") return idle();
      const elapsedMs = event.nowMs - phase.sinceMs;
      // Nothing has arrived -- that is what both phases mean -- so the attempt
      // is described honestly rather than with a count this does not track.
      const falling = shouldFallBack({ framesDelivered: 0, elapsedMs, failed: false }, deadlineMs);
      if (!falling) return idle();
      const reason: DriverStayReason =
        phase.phase === "probing" ? "worker-not-probed" : "no-first-frame";
      return stay(reason, [{ kind: "stop-worker", reason }]);
    }
  }
}

/** Whether the room is currently being fed by the worker. */
export function driverOnWorker(state: DriverState): boolean {
  return state.phase.phase === "worker";
}

/**
 * Whether anything is still waiting on a clock.
 *
 * Deliberately a different question from `driverNeedsWorker`. Both waiting
 * phases are on the first-frame deadline, and `worker` is not: a driver that
 * polled for as long as it needed the worker would run a timer four times a
 * second for the whole call, doing nothing, on the thread this work exists to
 * free.
 */
export function driverAwaitingWorker(state: DriverState): boolean {
  const p = state.phase.phase;
  return p === "probing" || p === "trying";
}

/**
 * Whether the worker is still worth keeping alive.
 *
 * `probing` and `trying` both need it; so does `worker`. Anything else means it
 * has nothing left to do, and a worker left running holds a WebGL context and a
 * 12MB WASM heap for the rest of the call.
 */
export function driverNeedsWorker(state: DriverState): boolean {
  const p = state.phase.phase;
  return p === "probing" || p === "trying" || p === "worker";
}
