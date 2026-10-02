/**
 * The order the main thread does things in, around a worker that may never work.
 *
 * Every assertion here is about one of two costs. A wrong ordering shows the
 * member a black tile, because these APIs fail by emitting nothing rather than
 * by throwing. A wrong latch either strands somebody on the slow path for the
 * rest of a call or re-pays the black-tile deadline every time they change
 * their background. Neither is visible by reading the reducer, so both are
 * pinned down case by case -- including the sequences that only happen on
 * browsers this container cannot run.
 */
import {
  driverAwaitingWorker,
  driverNeedsWorker,
  driverOnWorker,
  driverStep,
  initialDriverState,
  type DriverAction,
  type DriverEvent,
  type DriverState,
} from "@/lib/meetings/mask-driver-state";
import { FIRST_FRAME_DEADLINE_MS, type PipelineSupport } from "@/lib/meetings/mask-pipeline";

/** Chrome: both pre-standard halves on the main thread, no standard names. */
const chrome: PipelineSupport = {
  worker: true,
  trackProcessor: true,
  videoTrackGenerator: false,
  mediaStreamTrackGenerator: true,
  offscreenCanvas: true,
  videoFrame: true,
};

/**
 * A browser with only the standard: the insertable-streams pair exists in the
 * worker and nowhere else, so the main scope cannot answer the routing question
 * on its own. This is the shape the whole probe exists for.
 */
const standardMain: PipelineSupport = {
  worker: true,
  trackProcessor: false,
  videoTrackGenerator: false,
  mediaStreamTrackGenerator: false,
  offscreenCanvas: true,
  videoFrame: true,
};
const standardWorker: PipelineSupport = {
  worker: true,
  trackProcessor: true,
  videoTrackGenerator: true,
  mediaStreamTrackGenerator: false,
  offscreenCanvas: true,
  videoFrame: true,
};

const without = (base: PipelineSupport, missing: Partial<PipelineSupport>): PipelineSupport => ({
  ...base,
  ...missing,
});

/** Run a sequence from scratch and keep the last step's actions. */
function run(events: DriverEvent[], deadlineMs?: number) {
  let state: DriverState = initialDriverState();
  let actions: DriverAction[] = [];
  for (const event of events) {
    const step = driverStep(state, event, deadlineMs);
    state = step.state;
    actions = step.actions;
  }
  return { state, actions };
}

const begin = (main: PipelineSupport, nowMs = 1_000): DriverEvent => ({ kind: "begin", main, nowMs });

describe("driverStep: begin", () => {
  it("starts the main pipeline first on every browser, whatever happens next", () => {
    // The one invariant that cannot be traded away: the room gets a working
    // track before anything is known about the worker.
    for (const main of [chrome, standardMain, without(chrome, { worker: false })]) {
      const { actions } = run([begin(main)]);
      expect(actions[0]).toEqual({ kind: "start-main" });
    }
  });

  it("hands Chrome the streams without waiting for the worker to report", () => {
    const { state, actions } = run([begin(chrome, 1_000)]);
    expect(state.phase).toEqual({ phase: "trying", protocol: "transfer-streams", sinceMs: 1_000 });
    expect(actions).toEqual([
      { kind: "start-main" },
      { kind: "hand-over", protocol: "transfer-streams", sinceMs: 1_000 },
    ]);
    expect(state.fellBack).toBe(false);
  });

  it("waits for the worker when this scope cannot answer alone", () => {
    const { state, actions } = run([begin(standardMain, 1_000)]);
    expect(state.phase).toEqual({ phase: "probing", sinceMs: 1_000 });
    // The worker is built, but no track goes near it: there is nothing to hand
    // over to until it answers. And no reason is recorded either, because
    // `worker-not-probed` is a question rather than an answer.
    expect(actions).toEqual([{ kind: "start-main" }, { kind: "probe-worker" }]);
    expect(state.fellBack).toBe(false);
  });

  it("builds the worker on exactly the browsers that cannot answer alone", () => {
    // The defect this action exists for. A shell that inferred "build it" from
    // the phase would be one `if` away from never building it on the browsers
    // that implement only the standard -- which never report `support`, never
    // leave `probing`, and fall back every time.
    const probing = run([begin(standardMain, 1_000)]).actions;
    expect(probing).toContainEqual({ kind: "probe-worker" });
    // Chrome does not need it: `hand-over` builds the worker on its way past.
    expect(run([begin(chrome, 1_000)]).actions).not.toContainEqual({ kind: "probe-worker" });
    expect(
      run([begin(without(chrome, { worker: false }), 1_000)]).actions,
    ).not.toContainEqual({ kind: "probe-worker" });
  });

  it("settles on the main thread immediately when there are no workers at all", () => {
    const { state, actions } = run([begin(without(chrome, { worker: false }))]);
    expect(state.phase).toEqual({ phase: "main", reason: "no-worker" });
    expect(state.fellBack).toBe(true);
    expect(actions).toEqual([
      { kind: "start-main" },
      { kind: "stop-worker", reason: "no-worker" },
    ]);
  });

  it("records nowMs as the clock the deadline is measured from", () => {
    // `performance.now()` is not zero by the time a call is joined, so a phase
    // that defaulted its own start to 0 would blow the deadline on the first
    // tick. The begin event has to carry the clock.
    const { state } = run([begin(chrome, 90_000)]);
    expect(state.phase).toMatchObject({ sinceMs: 90_000 });
  });
});

describe("driverStep: worker-support", () => {
  const supported = (nowMs: number): DriverEvent => ({
    kind: "worker-support",
    main: standardMain,
    support: standardWorker,
    nowMs,
  });

  it("hands the track over on the standard protocol once the worker answers", () => {
    const { state, actions } = run([begin(standardMain, 1_000), supported(1_400)]);
    expect(state.phase).toEqual({ phase: "trying", protocol: "transfer-track", sinceMs: 1_400 });
    expect(actions).toEqual([{ kind: "hand-over", protocol: "transfer-track", sinceMs: 1_400 }]);
  });

  it("restarts the deadline clock at the hand-over, not at the probe", () => {
    const { state } = run([begin(standardMain, 1_000), supported(1_400)]);
    expect(state.phase).toMatchObject({ sinceMs: 1_400 });
  });

  it.each([
    ["no-offscreen-canvas", without(standardWorker, { offscreenCanvas: false })],
    ["no-video-frame", without(standardWorker, { videoFrame: false })],
    ["no-insertable-streams", without(standardWorker, { videoTrackGenerator: false })],
  ])("stops the worker and reports %s", (reason, support) => {
    const { state, actions } = run([
      begin(standardMain, 1_000),
      { kind: "worker-support", main: standardMain, support, nowMs: 1_400 },
    ]);
    expect(state.phase).toEqual({ phase: "main", reason });
    expect(state.fellBack).toBe(true);
    expect(actions).toEqual([{ kind: "stop-worker", reason }]);
  });

  it("ignores the decision once the track is already handed over", () => {
    // Chrome gets here on every call: it starts on `transfer-streams` without
    // waiting, and the worker still announces itself a moment later. Acting on
    // that would hand the camera over a second time.
    const before = run([begin(chrome, 1_000)]).state;
    const after = driverStep(before, {
      kind: "worker-support",
      main: chrome,
      support: standardWorker,
      nowMs: 1_400,
    });
    expect(after.actions).toEqual([]);
    expect(after.state.phase).toEqual(before.phase);
  });

  it("remembers the snapshot even when it ignores the decision", () => {
    // Ignored as a decision is not worthless as information: the restart path
    // routes off this.
    const before = run([begin(chrome, 1_000)]).state;
    expect(before.workerSupport).toBeNull();
    const after = driverStep(before, {
      kind: "worker-support",
      main: chrome,
      support: standardWorker,
      nowMs: 1_400,
    });
    expect(after.state.workerSupport).toEqual(standardWorker);
  });

  it("ignores a snapshot that arrives after the main thread has won", () => {
    const { state, actions } = run([
      begin(standardMain, 1_000),
      { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS },
      supported(9_000),
    ]);
    expect(actions).toEqual([]);
    expect(state.phase).toEqual({ phase: "main", reason: "worker-not-probed" });
  });
});

describe("driverStep: worker-ready", () => {
  it("is not a transition, because a built pipeline is exactly what emits nothing", () => {
    const before = run([begin(chrome, 1_000)]).state;
    const after = driverStep(before, { kind: "worker-ready", protocol: "transfer-streams" });
    expect(after.actions).toEqual([]);
    expect(after.state).toEqual(before);
    expect(driverOnWorker(after.state)).toBe(false);
  });

  it("does not let a ready worker out of probing either", () => {
    const before = run([begin(standardMain, 1_000)]).state;
    const after = driverStep(before, { kind: "worker-ready", protocol: "transfer-track" });
    expect(after.state.phase).toEqual({ phase: "probing", sinceMs: 1_000 });
    expect(after.actions).toEqual([]);
  });
});

describe("driverStep: worker-frame", () => {
  it("is the only thing that moves the room onto the worker", () => {
    const { state, actions } = run([begin(chrome, 1_000), { kind: "worker-frame" }]);
    expect(state.phase).toEqual({ phase: "worker", protocol: "transfer-streams" });
    expect(actions).toEqual([{ kind: "adopt-worker" }]);
    expect(driverOnWorker(state)).toBe(true);
    expect(state.fellBack).toBe(false);
  });

  it("keeps the protocol it won on", () => {
    const { state } = run([
      begin(standardMain, 1_000),
      { kind: "worker-support", main: standardMain, support: standardWorker, nowMs: 1_400 },
      { kind: "worker-frame" },
    ]);
    expect(state.phase).toEqual({ phase: "worker", protocol: "transfer-track" });
  });

  it("moves the room once, not once per frame", () => {
    // 24 `adopt-worker`s a second would be 24 `replaceTrack` calls per peer.
    const { state, actions } = run([
      begin(chrome, 1_000),
      { kind: "worker-frame" },
      { kind: "worker-frame" },
      { kind: "worker-frame" },
    ]);
    expect(actions).toEqual([]);
    expect(state.phase).toEqual({ phase: "worker", protocol: "transfer-streams" });
  });

  it("ignores a frame while still probing, since nothing was handed over", () => {
    const { state, actions } = run([begin(standardMain, 1_000), { kind: "worker-frame" }]);
    expect(state.phase).toEqual({ phase: "probing", sinceMs: 1_000 });
    expect(actions).toEqual([]);
  });

  it("ignores a frame that arrives after the deadline already fired", () => {
    // The worker has been told to stop but a frame was in flight. Adopting it
    // would move the room onto a track that is being torn down.
    const { state, actions } = run([
      begin(chrome, 1_000),
      { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS },
      { kind: "worker-frame" },
    ]);
    expect(state.phase).toEqual({ phase: "main", reason: "no-first-frame" });
    expect(actions).toEqual([]);
  });
});

describe("driverStep: worker-failed", () => {
  it("restarts the main pipeline BEFORE stopping a worker the room is watching", () => {
    const { state, actions } = run([
      begin(chrome, 1_000),
      { kind: "worker-frame" },
      { kind: "worker-failed", reason: "writer closed" },
    ]);
    // The order is the assertion. Stop first and the room is pointed at a dead
    // track for however long it takes the main pipeline to produce a frame.
    expect(actions).toEqual([
      { kind: "start-main" },
      { kind: "stop-worker", reason: "worker-failed" },
    ]);
    expect(state.phase).toEqual({ phase: "main", reason: "worker-failed" });
    expect(state.fellBack).toBe(true);
  });

  it("does not restart the main pipeline when it was never stopped", () => {
    // From `trying` the main thread is still the one feeding the room, so a
    // `start-main` here would be a pointless second `replaceTrack`.
    const { actions } = run([begin(chrome, 1_000), { kind: "worker-failed", reason: "no wasm" }]);
    expect(actions).toEqual([{ kind: "stop-worker", reason: "worker-failed" }]);
  });

  it("latches from probing too", () => {
    const { state, actions } = run([
      begin(standardMain, 1_000),
      { kind: "worker-failed", reason: "script load error" },
    ]);
    expect(state.phase).toEqual({ phase: "main", reason: "worker-failed" });
    expect(state.fellBack).toBe(true);
    expect(actions).toEqual([{ kind: "stop-worker", reason: "worker-failed" }]);
  });

  it("does not re-report a failure after the main thread has won", () => {
    const { state, actions } = run([
      begin(chrome, 1_000),
      { kind: "worker-failed", reason: "first" },
      { kind: "worker-failed", reason: "second" },
    ]);
    // The reason stays the first one: a worker that is already being torn down
    // can emit several errors on the way out, and they are not new information.
    expect(state.phase).toEqual({ phase: "main", reason: "worker-failed" });
    expect(actions).toEqual([]);
  });
});

describe("driverStep: the deadline", () => {
  it("does nothing while there is still time", () => {
    const before = run([begin(chrome, 1_000)]).state;
    const after = driverStep(before, { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS - 1 });
    expect(after.actions).toEqual([]);
    expect(after.state).toEqual(before);
  });

  it("fires exactly at the deadline", () => {
    const { state, actions } = run([
      begin(chrome, 1_000),
      { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS },
    ]);
    expect(state.phase).toEqual({ phase: "main", reason: "no-first-frame" });
    expect(state.fellBack).toBe(true);
    expect(actions).toEqual([{ kind: "stop-worker", reason: "no-first-frame" }]);
  });

  it("measures from the hand-over, not from the epoch", () => {
    // The whole point of carrying `sinceMs`. A tick at 90s is not late if the
    // track was handed over at 89.9s.
    const handed = run([begin(chrome, 89_900)]).state;
    expect(driverStep(handed, { kind: "tick", nowMs: 90_000 }).actions).toEqual([]);
    expect(
      driverStep(handed, { kind: "tick", nowMs: 89_900 + FIRST_FRAME_DEADLINE_MS }).actions,
    ).toEqual([{ kind: "stop-worker", reason: "no-first-frame" }]);
  });

  it("gives up on a worker that never even reports what it can do", () => {
    // The 404'd worker script: no `support`, no `failed`, nothing. Without this
    // the driver waits for the rest of the call holding a dead Worker, and the
    // member is never counted under any reason at all.
    const { state, actions } = run([
      begin(standardMain, 1_000),
      { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS },
    ]);
    expect(state.phase).toEqual({ phase: "main", reason: "worker-not-probed" });
    expect(state.fellBack).toBe(true);
    expect(actions).toEqual([{ kind: "stop-worker", reason: "worker-not-probed" }]);
    expect(driverNeedsWorker(state)).toBe(false);
  });

  it("separates the worker that never answered from the one that answered and went quiet", () => {
    // Both end on the main thread, and telemetry has to be able to tell a
    // chunk-serving problem from a broken pipeline.
    const never = run([
      begin(standardMain, 1_000),
      { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS },
    ]).state;
    const quiet = run([
      begin(standardMain, 1_000),
      { kind: "worker-support", main: standardMain, support: standardWorker, nowMs: 1_400 },
      { kind: "tick", nowMs: 1_400 + FIRST_FRAME_DEADLINE_MS },
    ]).state;
    expect(never.phase).toEqual({ phase: "main", reason: "worker-not-probed" });
    expect(quiet.phase).toEqual({ phase: "main", reason: "no-first-frame" });
  });

  it("stops applying once a frame has arrived", () => {
    const adopted = run([begin(chrome, 1_000), { kind: "worker-frame" }]).state;
    const after = driverStep(adopted, { kind: "tick", nowMs: 1_000_000 });
    expect(after.actions).toEqual([]);
    expect(after.state).toEqual(adopted);
  });

  it("does nothing on a tick before anything has begun", () => {
    const state = initialDriverState();
    const after = driverStep(state, { kind: "tick", nowMs: 5_000 });
    expect(after.state).toEqual(state);
    expect(after.actions).toEqual([]);
  });

  it("honours a deadline passed in", () => {
    const before = run([begin(chrome, 0)], 100).state;
    expect(driverStep(before, { kind: "tick", nowMs: 99 }, 100).actions).toEqual([]);
    expect(driverStep(before, { kind: "tick", nowMs: 100 }, 100).actions).toEqual([
      { kind: "stop-worker", reason: "no-first-frame" },
    ]);
  });
});

describe("driverStep: restart", () => {
  const restart = (main: PipelineSupport, nowMs: number): DriverEvent => ({
    kind: "restart",
    main,
    nowMs,
  });

  it("tries the worker again on a new camera when nothing has gone wrong", () => {
    const onWorker = run([begin(chrome, 1_000), { kind: "worker-frame" }]).state;
    const after = driverStep(onWorker, restart(chrome, 20_000));
    // Back to the main thread's track first, then a fresh hand-over: the new
    // camera is visible immediately rather than after another deadline.
    expect(after.actions).toEqual([
      { kind: "start-main" },
      { kind: "hand-over", protocol: "transfer-streams", sinceMs: 20_000 },
    ]);
    expect(after.state.phase).toEqual({
      phase: "trying",
      protocol: "transfer-streams",
      sinceMs: 20_000,
    });
  });

  it("routes a restart off the snapshot the worker already gave", () => {
    // The defect this exists for. The worker announces its support once, at
    // startup. A restart that forgot it would ask `pipelineRoute` with null,
    // get `worker-not-probed`, go back to probing, wait for a message that is
    // never coming, and latch a standard-only browser onto the main thread for
    // the rest of the call -- the first time the member changed background.
    const onWorker = run([
      begin(standardMain, 1_000),
      { kind: "worker-support", main: standardMain, support: standardWorker, nowMs: 1_400 },
      { kind: "worker-frame" },
    ]).state;
    const after = driverStep(onWorker, restart(standardMain, 20_000));
    expect(after.state.phase).toEqual({
      phase: "trying",
      protocol: "transfer-track",
      sinceMs: 20_000,
    });
    expect(after.actions).toContainEqual({
      kind: "hand-over",
      protocol: "transfer-track",
      sinceMs: 20_000,
    });
  });

  it("never hands over again once the main thread has won", () => {
    const fallen = run([
      begin(chrome, 1_000),
      { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS },
    ]).state;
    const after = driverStep(fallen, restart(chrome, 20_000));
    expect(after.actions).toEqual([{ kind: "start-main" }]);
    expect(after.state.fellBack).toBe(true);
    expect(driverNeedsWorker(after.state)).toBe(false);
  });

  it("keeps the real reason across a restart rather than inventing a fresh one", () => {
    // What the member is counted under has to survive this, or every latched
    // member ends up filed under whichever reason the restart path guessed.
    const fallen = run([begin(without(chrome, { worker: false }), 1_000)]).state;
    const after = driverStep(fallen, restart(without(chrome, { worker: false }), 20_000));
    expect(after.state.phase).toEqual({ phase: "main", reason: "no-worker" });
  });

  it("still restarts the main pipeline when the camera changes after a fallback", () => {
    // The latch is about the worker. The main pipeline has a new track to read
    // and must be told, or the member's tile keeps showing the old camera.
    const fallen = run([
      begin(chrome, 1_000),
      { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS },
    ]).state;
    expect(driverStep(fallen, restart(chrome, 20_000)).actions).toEqual([{ kind: "start-main" }]);
  });

  it("re-pays no deadline, which is the point of the latch", () => {
    // Five background changes on a browser where the worker does not work is
    // five more deadlines and five more doomed hand-overs without the latch.
    let state = run([
      begin(chrome, 1_000),
      { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS },
    ]).state;
    const handOvers: DriverAction[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const step = driverStep(state, restart(chrome, 20_000 * i));
      state = step.state;
      handOvers.push(...step.actions.filter((a) => a.kind === "hand-over"));
    }
    expect(handOvers).toEqual([]);
  });
});

describe("driverNeedsWorker", () => {
  it("is false before anything starts and after the main thread wins", () => {
    expect(driverNeedsWorker(initialDriverState())).toBe(false);
    expect(driverNeedsWorker(run([begin(without(chrome, { worker: false }))]).state)).toBe(false);
  });

  it("is true for every phase that is still waiting on it or using it", () => {
    expect(driverNeedsWorker(run([begin(standardMain, 1_000)]).state)).toBe(true);
    expect(driverNeedsWorker(run([begin(chrome, 1_000)]).state)).toBe(true);
    expect(
      driverNeedsWorker(run([begin(chrome, 1_000), { kind: "worker-frame" }]).state),
    ).toBe(true);
  });

  it("goes false the moment a worker is told to stop", () => {
    // What keeps a dead worker's WASM heap from outliving the decision to drop
    // it: every path that emits `stop-worker` also has to answer false here.
    const paths: DriverEvent[][] = [
      [begin(without(chrome, { worker: false }))],
      [begin(chrome, 1_000), { kind: "worker-failed", reason: "x" }],
      [begin(chrome, 1_000), { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS }],
      [begin(standardMain, 1_000), { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS }],
      [
        begin(standardMain, 1_000),
        { kind: "worker-support", main: standardMain, support: without(standardWorker, { offscreenCanvas: false }), nowMs: 1_400 },
      ],
      [begin(chrome, 1_000), { kind: "worker-frame" }, { kind: "worker-failed", reason: "x" }],
    ];
    for (const events of paths) {
      const { state, actions } = run(events);
      expect(actions).toContainEqual(expect.objectContaining({ kind: "stop-worker" }));
      expect(driverNeedsWorker(state)).toBe(false);
    }
  });
});

describe("driverAwaitingWorker", () => {
  it("is true for both waiting phases and nothing else", () => {
    expect(driverAwaitingWorker(initialDriverState())).toBe(false);
    expect(driverAwaitingWorker(run([begin(standardMain, 1_000)]).state)).toBe(true);
    expect(driverAwaitingWorker(run([begin(chrome, 1_000)]).state)).toBe(true);
    // The distinction from `driverNeedsWorker`: the worker is still needed here,
    // but nothing is waiting on a clock any more.
    const adopted = run([begin(chrome, 1_000), { kind: "worker-frame" }]).state;
    expect(driverNeedsWorker(adopted)).toBe(true);
    expect(driverAwaitingWorker(adopted)).toBe(false);
  });

  it("goes false the moment the main thread wins", () => {
    const fallen = run([
      begin(chrome, 1_000),
      { kind: "tick", nowMs: 1_000 + FIRST_FRAME_DEADLINE_MS },
    ]).state;
    expect(driverAwaitingWorker(fallen)).toBe(false);
  });
});
