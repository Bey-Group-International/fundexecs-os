import {
  type Device,
  canJoin,
  constraintsFor,
  devicesOfKind,
  levelBars,
  levelFromSamples,
  pickDevice,
  readinessProblems,
  smoothLevel,
} from "./devices";

const d = (over: Partial<Device>): Device => ({
  deviceId: "id",
  kind: "audioinput",
  label: "Mic",
  groupId: "g",
  ...over,
});

describe("devicesOfKind", () => {
  it("keeps only the requested kind", () => {
    const list = [d({ deviceId: "m" }), d({ deviceId: "c", kind: "videoinput" })];
    expect(devicesOfKind(list, "videoinput").map((x) => x.deviceId)).toEqual(["c"]);
  });

  // Before permission the browser returns empty labels — that is the spec.
  // Numbering them at least lets someone tell two devices apart.
  it("numbers unlabelled devices rather than showing blanks", () => {
    const list = [d({ deviceId: "a", label: "" }), d({ deviceId: "b", label: "   " })];
    expect(devicesOfKind(list, "audioinput").map((x) => x.label)).toEqual(["Microphone 1", "Microphone 2"]);
  });

  it("names each kind appropriately", () => {
    expect(devicesOfKind([d({ kind: "videoinput", label: "" })], "videoinput")[0].label).toBe("Camera 1");
    expect(devicesOfKind([d({ kind: "audiooutput", label: "" })], "audiooutput")[0].label).toBe("Speaker 1");
  });

  it("collapses a device reported twice", () => {
    const list = [d({ deviceId: "same", label: "Headset" }), d({ deviceId: "same", label: "Headset" })];
    expect(devicesOfKind(list, "audioinput")).toHaveLength(1);
  });

  it("keeps real labels as they are", () => {
    expect(devicesOfKind([d({ label: "Studio Mic" })], "audioinput")[0].label).toBe("Studio Mic");
  });
});

describe("pickDevice", () => {
  const list = [
    d({ deviceId: "default", label: "Default" }),
    d({ deviceId: "headset", label: "Headset" }),
  ];

  // Someone who picked their headset last time meant it.
  it("prefers what the member chose last time", () => {
    expect(pickDevice(list, "audioinput", "headset")?.deviceId).toBe("headset");
  });

  it("falls back to the system default when nothing is remembered", () => {
    expect(pickDevice(list, "audioinput", null)?.deviceId).toBe("default");
  });

  // Honouring an unplugged device is how you get a black preview and no clue why.
  it("ignores a remembered device that is no longer present", () => {
    expect(pickDevice(list, "audioinput", "unplugged-webcam")?.deviceId).toBe("default");
  });

  it("takes the first device when there is no system default", () => {
    expect(pickDevice([d({ deviceId: "only" })], "audioinput", null)?.deviceId).toBe("only");
  });

  it("returns nothing when there is nothing of that kind", () => {
    expect(pickDevice(list, "videoinput", null)).toBeNull();
  });
});

describe("constraintsFor", () => {
  it("turns on the processing that makes a laptop mic usable", () => {
    const c = constraintsFor("audioinput", null) as MediaTrackConstraints;
    expect(c).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  });

  it("lets noise suppression be turned off", () => {
    const c = constraintsFor("audioinput", null, { noiseSuppression: false }) as MediaTrackConstraints;
    expect(c.noiseSuppression).toBe(false);
  });

  it("pins an explicitly chosen device", () => {
    const c = constraintsFor("audioinput", "headset") as MediaTrackConstraints;
    expect(c.deviceId).toEqual({ exact: "headset" });
  });

  it("leaves the device unpinned when none is chosen", () => {
    expect((constraintsFor("videoinput", null) as MediaTrackConstraints).deviceId).toBeUndefined();
  });

  // On a mesh every participant uploads a copy to every other, so resolution
  // multiplies across the call rather than adding.
  it("caps video at 720p30", () => {
    const c = constraintsFor("videoinput", null) as MediaTrackConstraints;
    expect(c.width).toEqual({ ideal: 1280, max: 1280 });
    expect(c.frameRate).toEqual({ ideal: 30, max: 30 });
  });
});

describe("levelFromSamples", () => {
  it("reads silence as zero", () => {
    expect(levelFromSamples(new Float32Array(128))).toBe(0);
  });

  it("rises with signal", () => {
    const quiet = levelFromSamples(new Array(128).fill(0.02));
    const loud = levelFromSamples(new Array(128).fill(0.3));
    expect(loud).toBeGreaterThan(quiet);
  });

  it("stays within the meter's range", () => {
    expect(levelFromSamples(new Array(64).fill(1))).toBeLessThanOrEqual(1);
    expect(levelFromSamples(new Array(64).fill(-1))).toBeLessThanOrEqual(1);
  });

  it("survives an empty buffer and non-finite samples", () => {
    expect(levelFromSamples([])).toBe(0);
    expect(levelFromSamples([NaN, Infinity, 0.1])).toBeGreaterThanOrEqual(0);
  });

  // RMS, not peak: a single keyboard click should not read as speech.
  it("does not let one spike dominate a quiet buffer", () => {
    const withSpike = [...new Array(255).fill(0), 1];
    expect(levelFromSamples(withSpike)).toBeLessThan(levelFromSamples(new Array(256).fill(0.5)));
  });
});

describe("smoothLevel", () => {
  // Catching the start of a word matters; a bar that drops between syllables
  // reads as a broken microphone.
  it("rises faster than it falls", () => {
    const rise = smoothLevel(0, 1) - 0;
    const fall = 1 - smoothLevel(1, 0);
    expect(rise).toBeGreaterThan(fall);
  });

  it("moves toward the new value and settles there", () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = smoothLevel(v, 0.8);
    expect(v).toBeCloseTo(0.8, 1);
  });
});

describe("levelBars", () => {
  it("lights nothing at silence", () => {
    expect(levelBars(0)).toBe(0);
    expect(levelBars(-1)).toBe(0);
  });

  // Any detected sound should show something, or a quiet talker sees a dead meter.
  it("lights at least one bar for any real signal", () => {
    expect(levelBars(0.001)).toBe(1);
  });

  it("fills at full level and never overflows", () => {
    expect(levelBars(1, 12)).toBe(12);
    expect(levelBars(5, 12)).toBe(12);
  });
});

describe("readinessProblems", () => {
  const ok = {
    cameraDenied: false,
    micDenied: false,
    cameras: 1,
    mics: 1,
    micPeak: 0.4,
    cameraEnabled: true,
    micEnabled: true,
  };

  it("says nothing when everything works", () => {
    expect(readinessProblems(ok)).toEqual([]);
  });

  it("tells a blocked member what to actually do", () => {
    const [p] = readinessProblems({ ...ok, micDenied: true });
    expect(p.kind).toBe("mic_blocked");
    expect(p.message).toMatch(/address bar/);
  });

  it("reports a missing microphone in terms of the consequence", () => {
    expect(readinessProblems({ ...ok, mics: 0 })[0].message).toMatch(/won't hear you/);
  });

  // The whole point of a green room: find this here, not thirty seconds in.
  it("catches a microphone that is picking nothing up", () => {
    expect(readinessProblems({ ...ok, micPeak: 0 })[0].kind).toBe("mic_silent");
  });

  it("does not accuse a working mic just because nobody has spoken yet", () => {
    expect(readinessProblems({ ...ok, micEnabled: false, micPeak: 0 })).toEqual([]);
  });

  it("treats a missing camera as survivable, not fatal", () => {
    const [p] = readinessProblems({ ...ok, cameras: 0 });
    expect(p.kind).toBe("no_camera");
    expect(p.message).toMatch(/still join with audio/);
  });

  it("stays quiet about the camera when it is switched off deliberately", () => {
    expect(readinessProblems({ ...ok, cameras: 0, cameraEnabled: false })).toEqual([]);
  });

  it("reports both a blocked mic and a blocked camera", () => {
    const kinds = readinessProblems({ ...ok, micDenied: true, cameraDenied: true }).map((p) => p.kind);
    expect(kinds).toEqual(["mic_blocked", "camera_blocked"]);
  });
});

describe("canJoin", () => {
  it("lets someone in with a working mic", () => {
    expect(canJoin({ micDenied: false, mics: 1 })).toBe(true);
  });

  // Someone with no mic can still listen, and being locked out of a meeting you
  // were invited to is worse than joining muted.
  it("still lets someone in with no mic, so long as it is not blocked", () => {
    expect(canJoin({ micDenied: false, mics: 0 })).toBe(true);
  });

  it("stops only when the mic is both blocked and absent", () => {
    expect(canJoin({ micDenied: true, mics: 0 })).toBe(false);
  });
});
