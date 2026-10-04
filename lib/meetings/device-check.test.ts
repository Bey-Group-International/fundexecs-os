// The gate in front of a guest's first meeting.
//
// What matters here is not that the stages have the right names. It is that the
// two conditions are BOTH load-bearing — a measurement nobody confirmed and a
// confirmation with no measurement behind it each have to fail — and that the
// latch holds, because without it the check is a maze rather than a step.

import {
  CAMERA_SETTLE_MS,
  CAMERA_OFF_STEPS,
  MIC_OFF_STEPS,
  blockedReason,
  deviceOffBlocksEntry,
  measuringChosenDevice,
  offSteps,
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

  /**
   * The empty id is a change, not an exemption. An earlier version of this
   * exempted it, and that was wrong: the green room clears the id deliberately
   * when a REMEMBERED device turns out to be unplugged, so the next open takes
   * the system default. Exempting it meant a pass earned on the camera that is
   * no longer there survived onto its replacement.
   */
  it("resets when the id is cleared, because that is the system default taking over", () => {
    expect(deviceChanged("cam-a", "")).toBe(true);
  });

  it("still does not reset when nothing moved", () => {
    expect(deviceChanged("", "")).toBe(false);
  });
});

describe("measuringChosenDevice", () => {
  /**
   * The window a device swap opens. The choice changes at once, the new track
   * arrives later, and in between the rejected device is still open and still
   * feeding the meter — so without this a guest could answer "yes, the bars
   * move" about the microphone they had just replaced.
   */
  it("refuses to credit a track that is not the chosen device", () => {
    expect(measuringChosenDevice("mic-b", "mic-a")).toBe(false);
  });

  it("credits the chosen device", () => {
    expect(measuringChosenDevice("mic-b", "mic-b")).toBe(true);
  });

  /** An empty choice is "whatever the system default is" — nothing contradicts it. */
  it("credits anything when no particular device was chosen", () => {
    expect(measuringChosenDevice("", "mic-a")).toBe(true);
  });

  /**
   * A browser that does not report the device must not lock somebody out of
   * hardware that is working. Silence is read as agreement, not as a mismatch.
   */
  it("credits a track whose device the browser did not report", () => {
    expect(measuringChosenDevice("mic-b", null)).toBe(true);
    expect(measuringChosenDevice("mic-b", undefined)).toBe(true);
    expect(measuringChosenDevice("mic-b", "")).toBe(true);
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

describe("deviceOffBlocksEntry", () => {
  it("holds the gate shut on a device that was never checked", () => {
    expect(deviceOffBlocksEntry({ enabled: false, passed: false })).toBe(true);
  });

  /**
   * The point of the latch, from the other side: joining muted or with the
   * camera off is a state people want, and once a device has been checked,
   * switching it off must not shut them out again.
   */
  it("lets a checked device be switched off again", () => {
    expect(deviceOffBlocksEntry({ enabled: false, passed: true })).toBe(false);
  });

  it("is not what is wrong when the device is on", () => {
    expect(deviceOffBlocksEntry({ enabled: true, passed: false })).toBe(false);
  });

  /**
   * Both devices, not just the camera. The first version covered the camera
   * only, which left a guest who muted themselves being told their microphone
   * was broken and handed a list of other microphones to try.
   */
  it("tells each device how to get out of it, and that it is not permanent", () => {
    for (const device of ["camera", "microphone"] as const) {
      const steps = offSteps(device);
      expect(steps.length).toBeGreaterThan(1);
      expect(steps.join(" ")).toMatch(/back off|mute again/i);
    }
    expect(offSteps("camera")).toBe(CAMERA_OFF_STEPS);
    expect(offSteps("microphone")).toBe(MIC_OFF_STEPS);
  });

  it("asks the microphone to be unmuted, not replaced", () => {
    expect(MIC_OFF_STEPS[0]).toMatch(/unmute/i);
    expect(MIC_OFF_STEPS.join(" ")).not.toMatch(/different microphone|another microphone/i);
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
