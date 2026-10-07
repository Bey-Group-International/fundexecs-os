import {
  type Device,
  canJoin,
  constraintsFor,
  facingConstraints,
  releaseStream,
  settledFacing,
  devicesOfKind,
  isPhoneCamera,
  levelBars,
  levelFromSamples,
  pickDevice,
  readinessProblems,
  settleCamera,
  smoothLevel,
  displayConstraints,
  SCREEN_SHARE_FPS,
  SCREEN_SHARE_MAX_HEIGHT,
  needsSinkChange,
  speakerSinkLost,
  type SinkableElement,
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

  // A Mac with an iPhone nearby lists the iPhone first. Somebody sitting at
  // the laptop wants the laptop's camera, and chose nothing yet.
  it("starts a desktop member on a desktop camera rather than a phone", () => {
    const cams = [
      d({ deviceId: "iphone", kind: "videoinput", label: "iPhone Camera" }),
      d({ deviceId: "webcam", kind: "videoinput", label: "FaceTime HD Camera" }),
    ];
    expect(pickDevice(cams, "videoinput", null)?.deviceId).toBe("webcam");
  });

  it("still honours a phone camera the member chose last time", () => {
    const cams = [
      d({ deviceId: "iphone", kind: "videoinput", label: "iPhone Camera" }),
      d({ deviceId: "webcam", kind: "videoinput", label: "FaceTime HD Camera" }),
    ];
    expect(pickDevice(cams, "videoinput", "iphone")?.deviceId).toBe("iphone");
  });

  it("takes a phone camera when it is the only camera", () => {
    const cams = [d({ deviceId: "iphone", kind: "videoinput", label: "iPhone Camera" })];
    expect(pickDevice(cams, "videoinput", null)?.deviceId).toBe("iphone");
  });

  // The same Mac makes the iPhone the default MICROPHONE too, and the browser's
  // "default" entry carries its label. A phone on a desk is a microphone that
  // hears rustle; the transcript it produces is noise recognised as words.
  it("starts a desktop member on a real microphone when the default is a phone", () => {
    const mics = [
      d({ deviceId: "default", label: "Default - iPhone Microphone" }),
      d({ deviceId: "iphone-mic", label: "iPhone Microphone" }),
      d({ deviceId: "laptop-mic", label: "MacBook Pro Microphone" }),
    ];
    expect(pickDevice(mics, "audioinput", null)?.deviceId).toBe("laptop-mic");
  });

  it("keeps the system default microphone when it is not a phone", () => {
    const mics = [
      d({ deviceId: "default", label: "Default - MacBook Pro Microphone" }),
      d({ deviceId: "iphone-mic", label: "iPhone Microphone" }),
    ];
    expect(pickDevice(mics, "audioinput", null)?.deviceId).toBe("default");
  });

  it("skips a phone microphone listed first when there is no default entry", () => {
    const mics = [
      d({ deviceId: "iphone-mic", label: "iPhone Microphone" }),
      d({ deviceId: "laptop-mic", label: "MacBook Pro Microphone" }),
    ];
    expect(pickDevice(mics, "audioinput", null)?.deviceId).toBe("laptop-mic");
  });

  it("still honours a phone microphone the member chose, and takes one when it is all there is", () => {
    const mics = [
      d({ deviceId: "default", label: "Default - iPhone Microphone" }),
      d({ deviceId: "iphone-mic", label: "iPhone Microphone" }),
    ];
    expect(pickDevice(mics, "audioinput", "iphone-mic")?.deviceId).toBe("iphone-mic");
    expect(pickDevice(mics, "audioinput", null)?.deviceId).toBe("default");
  });
});

describe("settleCamera", () => {
  const cams = [
    d({ deviceId: "iphone", kind: "videoinput", label: "iPhone Camera" }),
    d({ deviceId: "webcam", kind: "videoinput", label: "FaceTime HD Camera" }),
  ];

  // The browser, asked for "a camera", handed back the iPhone. The labels
  // arrived afterwards and say there is a real camera: that is the choice.
  it("trades a phone the browser picked for a desktop camera", () => {
    expect(settleCamera(cams, "iphone")).toBe("webcam");
  });

  it("keeps a desktop camera the browser picked", () => {
    expect(settleCamera(cams, "webcam")).toBe("webcam");
  });

  it("keeps a phone that is the only camera", () => {
    expect(settleCamera([cams[0]], "iphone")).toBe("iphone");
  });

  it("keeps an id it cannot find in the list", () => {
    expect(settleCamera(cams, "mystery")).toBe("mystery");
  });
});

describe("isPhoneCamera", () => {
  it("recognises the phones that desktops list as cameras", () => {
    for (const label of [
      "iPhone Camera",
      "Sheika's iPhone (Continuity Camera)",
      "iPad Camera",
      "DroidCam Source 3",
      "Camo Camera",
      "Iriun Webcam",
      "EpocCam Camera",
      "e2eSoft iVCam",
      "Phone Link Camera",
      "Android Webcam",
    ]) {
      expect(isPhoneCamera(label)).toBe(true);
    }
  });

  it("leaves real cameras alone", () => {
    for (const label of ["FaceTime HD Camera", "Logitech BRIO", "Integrated Webcam", "OBS Virtual Camera", "Camera 1", "HD Pro Webcam C920"]) {
      expect(isPhoneCamera(label)).toBe(false);
    }
  });

  it("reads an unlabelled device as not a phone", () => {
    expect(isPhoneCamera("")).toBe(false);
    expect(isPhoneCamera(null)).toBe(false);
    expect(isPhoneCamera(undefined)).toBe(false);
  });
});

describe("constraintsFor", () => {
  it("turns on the processing that makes a laptop mic usable", () => {
    const c = constraintsFor("audioinput", null) as MediaTrackConstraints;
    expect(c).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
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

/**
 * Flipping to the rear camera on a phone opens the HIGHEST-resolution sensor on
 * the device. `flipCamera` asked for `{ facingMode }` and nothing else while
 * `switchCam`, doing the same job fifty lines away, carried the bounds — so a
 * flip put a 4K 60fps capture on a mesh call, and nothing downstream undoes it:
 * `videoSendCap` sets `scaleResolutionDownBy: 1` at any healthy bitrate, so the
 * encoder is told to keep every one of those pixels.
 *
 * The bounds live in one place now, and these tests are what keep the two
 * callers from drifting apart again.
 */
describe("facingConstraints", () => {
  it("holds a flipped camera to the same 720p30 ceiling as a chosen one", () => {
    const flipped = facingConstraints("environment");
    const chosen = constraintsFor("videoinput", null) as MediaTrackConstraints;
    expect(flipped.width).toEqual(chosen.width);
    expect(flipped.height).toEqual(chosen.height);
    expect(flipped.frameRate).toEqual(chosen.frameRate);
  });

  it("asks for the side it was given", () => {
    expect(facingConstraints("environment").facingMode).toBe("environment");
    expect(facingConstraints("user").facingMode).toBe("user");
  });

  /**
   * `{ exact: ... }` would throw OverconstrainedError on any machine with one
   * camera, and for a flip button a failed open is worse than getting the same
   * camera back. So it asks, and the caller reads back what it got.
   */
  it("asks rather than demands, so a one-camera machine still opens", () => {
    expect(facingConstraints("environment").facingMode).not.toHaveProperty("exact");
  });

  it("does not pin a device, which would contradict the side", () => {
    expect(facingConstraints("user").deviceId).toBeUndefined();
  });

  /** A fresh object each time: a shared one could be mutated by a caller and
   *  silently change what every later camera is opened with. */
  it("hands back its own object", () => {
    const first = facingConstraints("user");
    first.width = { ideal: 4096 };
    expect(facingConstraints("user").width).toEqual({ ideal: 1280, max: 1280 });
    expect((constraintsFor("videoinput", null) as MediaTrackConstraints).width)
      .toEqual({ ideal: 1280, max: 1280 });
  });
});

/**
 * The three paths that open a device mid-call each have to release what they
 * opened when the hand-over does not complete. Two of them covered only the
 * early return and not a throw — which leaves a live capture of the same sensor
 * and the hardware light on — and none guarded `stop()` itself, so a track that
 * had already ended turned a clean release into "that camera could not be
 * opened".
 *
 * Whether to release stays with the caller, because that is the one thing this
 * cannot know: an adopted track belongs to the room, and stopping it then would
 * kill the camera the member is now using.
 */
describe("releaseStream", () => {
  const stream = (count: number) => {
    const tracks = Array.from({ length: count }, () => ({ stopped: 0, stop() { this.stopped += 1; } }));
    return { tracks, stream: { getTracks: () => tracks as unknown as MediaStreamTrack[] } };
  };

  it("stops every track it was given", () => {
    const { tracks, stream: s } = stream(3);
    releaseStream(s);
    expect(tracks.map((t) => t.stopped)).toEqual([1, 1, 1]);
  });

  it("does nothing when there is no stream", () => {
    expect(() => releaseStream(null)).not.toThrow();
    expect(() => releaseStream(undefined)).not.toThrow();
  });

  /** The case that turned a clean release into a reported failure: a track that
   *  had already ended. */
  it("keeps going when a track refuses to stop", () => {
    const later = { stopped: 0, stop() { this.stopped += 1; } };
    const s = {
      getTracks: () => [
        { stop() { throw new Error("already stopped"); } },
        later,
      ] as unknown as MediaStreamTrack[],
    };
    expect(() => releaseStream(s)).not.toThrow();
    // And the track after the throwing one is still released, which is the
    // whole point of stopping each one inside its own guard.
    expect(later.stopped).toBe(1);
  });

  it("survives a stream that cannot list its tracks", () => {
    const s = { getTracks: () => { throw new Error("gone"); } };
    expect(() => releaseStream(s)).not.toThrow();
  });

  it("is fine with a stream holding nothing", () => {
    expect(() => releaseStream({ getTracks: () => [] })).not.toThrow();
  });
});

/**
 * Because the flip asks rather than demands, it can legitimately come back with
 * the camera it started on — and recording the side that was REQUESTED left the
 * button claiming the rear camera while showing a face.
 */
describe("settledFacing", () => {
  it("believes the browser over the request", () => {
    expect(settledFacing("user", "environment")).toBe("user");
    expect(settledFacing("environment", "user")).toBe("environment");
  });

  it("falls back to what was asked when the browser reports nothing", () => {
    expect(settledFacing(undefined, "environment")).toBe("environment");
    expect(settledFacing(null, "user")).toBe("user");
    expect(settledFacing("", "environment")).toBe("environment");
  });

  /** A desktop camera may report "left"/"right", neither of which is a side
   *  this button can show. The request is the better answer than a value the
   *  rest of the room cannot read. */
  it("ignores a facing it does not recognise", () => {
    expect(settledFacing("left", "user")).toBe("user");
    expect(settledFacing("environment ", "user")).toBe("user");
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

  // "No camera found" sends someone looking for hardware that is plugged in,
  // working, and held by the Zoom window behind this one. The instruction that
  // fixes it is a different instruction.
  it("says a camera is taken rather than absent", () => {
    const [p] = readinessProblems({ ...ok, cameras: 0, cameraBusy: true });
    expect(p.kind).toBe("camera_busy");
    expect(p.message).toMatch(/Another app/);
  });

  it("says a microphone is taken rather than absent", () => {
    const [p] = readinessProblems({ ...ok, mics: 0, micBusy: true });
    expect(p.kind).toBe("mic_busy");
    expect(p.message).toMatch(/Another app/);
  });

  // Blocked is the stronger fact: no other application can be reached from the
  // address bar, and that is the only thing that will help.
  it("prefers blocked over busy when both are reported", () => {
    const kinds = readinessProblems({
      ...ok, micDenied: true, micBusy: true, cameraDenied: true, cameraBusy: true,
    }).map((p) => p.kind);
    expect(kinds).toEqual(["mic_blocked", "camera_blocked"]);
  });

  it("stays quiet about a busy camera that was switched off deliberately", () => {
    expect(readinessProblems({ ...ok, cameraEnabled: false, cameras: 0, cameraBusy: true })).toEqual([]);
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

describe("what to ask for when sharing a screen", () => {
  // The request used to be a bare `{ video: true }` — on a 4K monitor, a
  // 3840x2160 source captured at whatever the compositor runs, re-encoded
  // continuously, on the one machine also running the meeting and the thing
  // being presented.
  it("caps the frame rate, because a shared screen barely moves", () => {
    const video = displayConstraints().video as MediaTrackConstraints;
    expect(video.frameRate).toEqual({ ideal: SCREEN_SHARE_FPS });
    expect(SCREEN_SHARE_FPS).toBeLessThan(30);
  });

  // This used to assert the opposite — that the resolution was left entirely
  // alone — on the reasoning that resolution is what makes text readable. That
  // reasoning is right and is exactly why the unbounded version defeated
  // itself: a 5K panel was captured at 5120x2880 and handed to an encoder that
  // screenSendCap forbids to scale, on a few hundred kilobits. The pixels were
  // kept and the legibility they were kept for was spent on them.
  it("caps the height, because no mesh budget can carry a 5K panel", () => {
    const video = displayConstraints().video as MediaTrackConstraints;
    expect(video.height).toEqual({ ideal: SCREEN_SHARE_MAX_HEIGHT });
    expect(SCREEN_SHARE_MAX_HEIGHT).toBeLessThan(2160);
  });

  // Height only: the member picked a window, a tab or a whole display, and
  // constraining both axes would letterbox whichever one they chose.
  it("leaves the aspect ratio to the browser", () => {
    const video = displayConstraints().video as MediaTrackConstraints;
    expect(video.width).toBeUndefined();
  });

  // A screen already smaller than the ceiling must not be blown up to meet it.
  it("is a ceiling rather than a target", () => {
    const height = (displayConstraints().video as MediaTrackConstraints).height;
    expect(height).not.toHaveProperty("min");
    expect(height).not.toHaveProperty("exact");
  });

  // `ideal` rather than `max`: an OverconstrainedError here reaches the member
  // as a share button that does nothing.
  it("asks rather than demands, so no browser can refuse outright", () => {
    const json = JSON.stringify(displayConstraints());
    expect(json).not.toContain("max");
    expect(json).not.toContain("exact");
  });

  // Asking for audio without carrying it anywhere would light the "sharing
  // audio" indicator while sending silence.
  it("does not ask for audio it has nowhere to send", () => {
    expect(displayConstraints().audio).toBe(false);
  });
});

describe("needsSinkChange", () => {
  const el = (over: Partial<SinkableElement> = {}): SinkableElement => ({
    srcObject: {},
    muted: false,
    sinkId: "",
    setSinkId: async () => {},
    ...over,
  });

  it("routes an unmuted call element that is on the wrong device", () => {
    expect(needsSinkChange(el({ sinkId: "" }), "out-desk")).toBe(true);
    expect(needsSinkChange(el({ sinkId: "out-old" }), "out-desk")).toBe(true);
  });

  it("skips an element already on that device", () => {
    expect(needsSinkChange(el({ sinkId: "out-desk" }), "out-desk")).toBe(false);
  });

  it("skips a never-routed element when the choice IS the system default", () => {
    // The bug this rule replaced: a fresh element reports "" while the chosen
    // id is "default", so the equality check failed every time and every
    // element on the page was rebuilt on every change to the roster.
    expect(needsSinkChange(el({ sinkId: "" }), "default")).toBe(false);
  });

  it("skips anything that is not call media", () => {
    // A player on a route rendered behind the call, a background clip: those
    // carry a `src`, not a `srcObject`, and are nobody's business here.
    expect(needsSinkChange(el({ srcObject: null }), "out-desk")).toBe(false);
    expect(needsSinkChange(el({ srcObject: undefined }), "out-desk")).toBe(false);
  });

  it("skips a muted element, which renders no audio at all", () => {
    // The local tile. Routing it is a pipeline rebuild for something that will
    // never play — and it is muted precisely so the member does not hear
    // themselves.
    expect(needsSinkChange(el({ muted: true }), "out-desk")).toBe(false);
  });

  it("skips a browser with no setSinkId", () => {
    expect(needsSinkChange(el({ setSinkId: undefined }), "out-desk")).toBe(false);
  });
});

describe("speakerSinkLost", () => {
  const outs = (...ids: string[]) => ids.map((deviceId) => ({ deviceId, kind: "audiooutput" as const }));
  const mic = { deviceId: "mic-1", kind: "audioinput" as const };

  it("is lost when the chosen output is no longer enumerated", () => {
    expect(speakerSinkLost("headset-1", [mic, ...outs("default", "out-desk")])).toBe(true);
  });

  it("is not lost while the chosen output is still there", () => {
    expect(speakerSinkLost("headset-1", [mic, ...outs("default", "headset-1")])).toBe(false);
  });

  it("never loses the system default — it is whatever the system says now", () => {
    expect(speakerSinkLost("", outs("out-desk"))).toBe(false);
    expect(speakerSinkLost("default", outs("out-desk"))).toBe(false);
  });

  it("says nothing when the browser lists no outputs at all", () => {
    // Absence of information, not absence of the device.
    expect(speakerSinkLost("headset-1", [mic])).toBe(false);
    expect(speakerSinkLost("headset-1", [])).toBe(false);
  });
});
