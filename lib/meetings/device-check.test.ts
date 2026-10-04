// The gate in front of a guest's first meeting.
//
// What matters here is not that the stages have the right names. It is that the
// two conditions are BOTH load-bearing — a measurement nobody confirmed and a
// confirmation with no measurement behind it each have to fail — and that the
// latch holds, because without it the check is a maze rather than a step.

import {
  CAMERA_SETTLE_MS,
  CAMERA_OFF_STEPS,
  blockedReason,
  cameraOffBlocksEntry,
  checkCopy,
  checkStage,
  deviceChanged,
  deviceCheckRequired,
  entryAllowed,
  shouldLatch,
  type CheckStage,
} from "@/lib/meetings/device-check";
import type { ReadinessProblem } from "@/lib/meetings/devices";

const blocked: ReadinessProblem = { kind: "mic_blocked", message: "blocked" };

/** The ordinary case: nothing latched, nothing wrong, no answer yet. */
const base = { passed: false, problem: null, signal: true, signalSettled: true, answer: null } as const;

describe("deviceCheckRequired", () => {
  it("gates guests", () => {
    expect(deviceCheckRequired({ isGuest: true })).toBe(true);
  });

  /**
   * Hosts and members are not gated, and this is the decision rather than an
   * omission: somebody who joins unheard with colleagues in the room is told so
   * within seconds, and being made late to their own meeting costs them more
   * than a quiet first minute.
   */
  it("does not gate a host or a member", () => {
    expect(deviceCheckRequired({ isGuest: false })).toBe(false);
  });
});

describe("checkStage", () => {
  it("waits rather than accusing a device that is merely slow to start", () => {
    // Every guest would otherwise be told their camera is broken for the first
    // few seconds of every join, which teaches them to ignore this screen.
    expect(checkStage({ ...base, signal: false, signalSettled: false })).toBe("measuring");
  });

  it("calls persistent silence a fault once it has had long enough", () => {
    expect(checkStage({ ...base, signal: false, signalSettled: true })).toBe("blocked");
  });

  it("prefers a named problem over bare silence", () => {
    // A blocked microphone and a merely silent one look identical from the
    // meter; only one of them has steps that will fix it.
    expect(checkStage({ ...base, problem: blocked, signal: false, signalSettled: false })).toBe("blocked");
    expect(checkStage({ ...base, problem: blocked, signal: true })).toBe("blocked");
  });

  it("asks the person once signal is arriving", () => {
    expect(checkStage(base)).toBe("confirming");
  });

  /** The measurement half, alone, is not a pass. */
  it("does not pass on signal that nobody confirmed", () => {
    expect(checkStage({ ...base, answer: null })).not.toBe("passed");
  });

  /**
   * The confirmation half, alone, is not a pass either — this is the lens-cap
   * and the clicked-through-without-looking case meeting in one assertion.
   */
  it("does not pass on a yes with no signal behind it", () => {
    expect(checkStage({ ...base, signal: false, signalSettled: true, answer: true })).toBe("blocked");
  });

  it("passes when the browser and the person agree", () => {
    expect(checkStage({ ...base, answer: true })).toBe("passed");
  });

  it("takes no for an answer and offers guidance", () => {
    expect(checkStage({ ...base, answer: false })).toBe("rejected");
  });

  /**
   * The latch. A guest who verified their camera and then turned it off on
   * purpose, or stopped talking, must not be sent back to the start — "turn
   * your camera on to be let in, then turn it off again" is not a step.
   */
  it("stays passed once latched, whatever happens afterwards", () => {
    expect(checkStage({ passed: true, problem: blocked, signal: false, signalSettled: true, answer: false }))
      .toBe("passed");
  });
});

describe("shouldLatch", () => {
  it("latches the first pass and not the ones after it", () => {
    expect(shouldLatch("passed", false)).toBe(true);
    expect(shouldLatch("passed", true)).toBe(false);
  });

  it("latches nothing else", () => {
    for (const stage of ["measuring", "blocked", "confirming", "rejected"] as CheckStage[]) {
      expect(shouldLatch(stage, false)).toBe(false);
    }
  });
});

describe("entryAllowed", () => {
  it("needs both devices", () => {
    expect(entryAllowed({ camera: "passed", microphone: "passed" })).toBe(true);
    expect(entryAllowed({ camera: "passed", microphone: "confirming" })).toBe(false);
    expect(entryAllowed({ camera: "rejected", microphone: "passed" })).toBe(false);
  });

  /**
   * There is no "join anyway". A guest whose microphone cannot be made to work
   * does not get in. That is the instruction, and it is asserted here so that
   * softening it later is a test failure rather than a quiet edit.
   */
  it("admits nobody on a blocked device, however the other one looks", () => {
    expect(entryAllowed({ camera: "passed", microphone: "blocked" })).toBe(false);
    expect(entryAllowed({ camera: "blocked", microphone: "blocked" })).toBe(false);
  });
});

describe("deviceChanged", () => {
  it("resets when a different device is chosen", () => {
    // What was verified was one piece of hardware. Carrying the answer across is
    // how somebody passes on a working webcam and joins on a broken one.
    expect(deviceChanged("cam-a", "cam-b")).toBe(true);
  });

  it("does not reset on the same id arriving again", () => {
    // A re-render handing back the same choice must not reset anything, or the
    // check could never be completed at all.
    expect(deviceChanged("cam-a", "cam-a")).toBe(false);
  });

  it("does not reset on an empty id", () => {
    // Device lists arrive empty before permission is granted; treating that as a
    // change would clear a pass every time the list was re-read.
    expect(deviceChanged("cam-a", "")).toBe(false);
  });
});

describe("checkCopy", () => {
  /**
   * The microphone is asked about the METER, not about hearing. Nothing in this
   * check plays sound, so "can you hear yourself?" would be a question the
   * screen gives no way to answer.
   */
  it("asks about the bars, not about hearing", () => {
    const copy = checkCopy("microphone", "confirming");
    expect(copy.question).toMatch(/bars/i);
    expect(copy.question).not.toMatch(/hear/i);
  });

  it("asks the camera about the preview", () => {
    expect(checkCopy("camera", "confirming").question).toMatch(/see yourself/i);
  });

  it("gives steps exactly where there is something to do", () => {
    for (const device of ["camera", "microphone"] as const) {
      expect(checkCopy(device, "rejected").steps.length).toBeGreaterThan(0);
      expect(checkCopy(device, "blocked").steps.length).toBeGreaterThan(0);
      expect(checkCopy(device, "passed").steps).toEqual([]);
      expect(checkCopy(device, "measuring").steps).toEqual([]);
    }
  });

  it("keeps the question up while they are being told what to try", () => {
    // The row still has to be answerable: the steps are what to change, and the
    // question is how they say it worked.
    expect(checkCopy("camera", "rejected").question).not.toBeNull();
    expect(checkCopy("microphone", "rejected").question).not.toBeNull();
  });

  it("names the device in every stage, so a row is never anonymous", () => {
    for (const device of ["camera", "microphone"] as const) {
      for (const stage of ["measuring", "blocked", "confirming", "rejected", "passed"] as CheckStage[]) {
        expect(checkCopy(device, stage).label).toMatch(device === "camera" ? /camera/i : /microphone/i);
      }
    }
  });
});

describe("cameraOffBlocksEntry", () => {
  it("holds the gate shut on a camera that was never checked", () => {
    expect(cameraOffBlocksEntry({ enabled: false, passed: false })).toBe(true);
  });

  /**
   * The point of the latch, from the other side: joining with the camera off is
   * a state people want, and once it has been checked, switching it off must not
   * shut them out again.
   */
  it("lets a checked camera be switched off again", () => {
    expect(cameraOffBlocksEntry({ enabled: false, passed: true })).toBe(false);
  });

  it("is not what is wrong when the camera is on", () => {
    expect(cameraOffBlocksEntry({ enabled: true, passed: false })).toBe(false);
  });

  it("says how to get out of it, including that it is not permanent", () => {
    expect(CAMERA_OFF_STEPS.length).toBeGreaterThan(1);
    expect(CAMERA_OFF_STEPS.join(" ")).toMatch(/turn it straight back off|back off/i);
  });
});

describe("blockedReason", () => {
  it("says nothing when the gate is open", () => {
    expect(blockedReason({ camera: "passed", microphone: "passed" })).toBeNull();
  });

  /** "Check your devices" in front of somebody whose camera is fine costs them
   * the next two minutes, so the sentence names the one that is in the way. */
  it("names the device that is actually in the way", () => {
    expect(blockedReason({ camera: "passed", microphone: "blocked" })).toMatch(/microphone/i);
    expect(blockedReason({ camera: "passed", microphone: "blocked" })).not.toMatch(/camera/i);
    expect(blockedReason({ camera: "rejected", microphone: "passed" })).toMatch(/camera/i);
    expect(blockedReason({ camera: "rejected", microphone: "passed" })).not.toMatch(/microphone/i);
  });

  it("names both when both are outstanding", () => {
    const both = blockedReason({ camera: "measuring", microphone: "measuring" }) ?? "";
    expect(both).toMatch(/microphone/i);
    expect(both).toMatch(/camera/i);
  });
});

describe("CAMERA_SETTLE_MS", () => {
  it("is long enough for a camera to start and short enough to be waited out", () => {
    expect(CAMERA_SETTLE_MS).toBeGreaterThanOrEqual(1_500);
    expect(CAMERA_SETTLE_MS).toBeLessThanOrEqual(6_000);
  });
});
