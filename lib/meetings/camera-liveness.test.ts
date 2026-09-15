// Whether the camera is actually doing what the room says it is doing.
//
// The reported failure: configure the camera in the green room, start the
// meeting, and it is not live for anyone until the member opens device settings
// and picks the same camera again. It reproduces on every join path, with and
// without a background, which is why this judges the camera by what it IS doing
// rather than by how it got there.

import {
  CAMERA_CHECK_MS,
  cameraVerdict,
  needsRepair,
  repairFor,
  type CameraFacts,
} from "./camera-liveness";

const live = { readyState: "live", enabled: true };

/** A camera the member asked for, with whatever state the test cares about. */
function facts(over: Partial<CameraFacts> = {}): CameraFacts {
  return { wanted: true, on: true, track: live, ...over };
}

describe("a camera that is working", () => {
  it("is left alone", () => {
    expect(cameraVerdict(facts())).toBe("live");
    expect(needsRepair("live")).toBe(false);
    expect(repairFor("live")).toBe("none");
  });

  // Joining with the camera off is a choice, not a fault. Repairing it would
  // turn on a camera somebody deliberately left dark.
  it("is not invented for somebody who joined without one", () => {
    expect(cameraVerdict(facts({ wanted: false, track: null }))).toBe("not_wanted");
    expect(needsRepair("not_wanted")).toBe(false);
  });

  it("stays not-wanted even if a track is somehow lying around", () => {
    expect(cameraVerdict(facts({ wanted: false, track: live }))).toBe("not_wanted");
  });

  // The member turned their camera off in the call. The track stays open and
  // disabled on purpose, and the controls agree, so there is nothing to fix.
  it("is left alone when the member themselves turned it off", () => {
    expect(cameraVerdict(facts({ on: false, track: { readyState: "live", enabled: false } }))).toBe("live");
  });
});

describe("a camera that is not", () => {
  // The device was never opened — the green room's track was stopped and the
  // same camera asked for again before the driver let go.
  it("notices that there is no track at all", () => {
    expect(cameraVerdict(facts({ track: null }))).toBe("no_track");
    expect(repairFor("no_track")).toBe("reopen");
  });

  it("notices a track that has already stopped", () => {
    expect(cameraVerdict(facts({ track: { readyState: "ended", enabled: true } }))).toBe("dead_track");
    expect(repairFor("dead_track")).toBe("reopen");
  });

  // The silent one: the background hold disables the track until the segmenter
  // builds, and any route out that forgets to re-enable it leaves an open,
  // working camera sending nothing behind a UI that says it is on.
  it("notices a track switched off behind a UI that says it is on", () => {
    expect(cameraVerdict(facts({ on: true, track: { readyState: "live", enabled: false } }))).toBe("disabled");
    expect(needsRepair("disabled")).toBe(true);
  });

  // Reopening would work and would also blink the camera light in front of
  // somebody watching their own face, for a fault that takes no time to fix.
  it("sets a flag rather than opening a device it already has", () => {
    expect(repairFor("disabled")).toBe("enable");
  });

  it("treats every broken state as worth acting on", () => {
    for (const verdict of ["no_track", "dead_track", "disabled"] as const) {
      expect(needsRepair(verdict)).toBe(true);
      expect(repairFor(verdict)).not.toBe("none");
    }
  });

  // A dead camera is a dead camera whichever way the flag points. The flag is
  // the less trustworthy of the two, so it does not get a say here.
  it("does not let the controls talk it out of a dead track", () => {
    expect(cameraVerdict(facts({ on: false, track: { readyState: "ended", enabled: true } }))).toBe("dead_track");
    expect(cameraVerdict(facts({ on: false, track: null }))).toBe("no_track");
  });
});

describe("when to look", () => {
  // A freshly opened track reports muted for a moment before the first frame,
  // and the background hold is released only once a 12MB segmenter has landed.
  // Judging either immediately would condemn a camera that is merely starting.
  it("waits long enough not to condemn a camera that is still starting", () => {
    expect(CAMERA_CHECK_MS).toBeGreaterThanOrEqual(2_000);
  });

  // And not so long that somebody spends the opening of their meeting invisible.
  it("does not wait so long that the meeting starts without them", () => {
    expect(CAMERA_CHECK_MS).toBeLessThanOrEqual(5_000);
  });
});
