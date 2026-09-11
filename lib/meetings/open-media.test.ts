import { openCallMedia, type MediaGateway } from "./open-media";

// ── Fakes ────────────────────────────────────────────────────────────────────
//
// Small on purpose. The whole reason openCallMedia takes a gateway is that the
// failure it exists to fix — one application holding a camera — is otherwise
// only reproducible by running two applications.

type FakeTrack = { kind: string; deviceId: string; stopped: boolean };

function track(kind: "video" | "audio", deviceId: string): FakeTrack {
  return { kind, deviceId, stopped: false };
}

function streamOf(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
  } as unknown as MediaStream;
}

/** A track that reports which device it is really on, the way a real one does. */
function reporting(t: FakeTrack): FakeTrack {
  return Object.assign(t, {
    getSettings: () => ({ deviceId: t.deviceId }),
    stop() { t.stopped = true; },
  });
}

function err(name: string): Error {
  return Object.assign(new Error(name), { name });
}

interface GatewayLog {
  gateway: MediaGateway;
  calls: MediaStreamConstraints[];
  waits: number[];
}

/**
 * A gateway driven by a handler that sees each request in turn.
 *
 * `constraints` carries the deviceId the walk asked for, so a handler can fail
 * one camera and open another — which is the behaviour under test.
 */
function gatewayFor(
  handle: (c: MediaStreamConstraints, n: number) => MediaStream | Error,
  devices: MediaDeviceInfo[] = [],
): GatewayLog {
  const calls: MediaStreamConstraints[] = [];
  const waits: number[] = [];
  return {
    calls,
    waits,
    gateway: {
      async getUserMedia(c) {
        calls.push(c);
        const out = handle(c, calls.length);
        if (out instanceof Error) throw out;
        return out;
      },
      async enumerateDevices() { return devices; },
      async wait(ms) { waits.push(ms); },
    },
  };
}

const device = (kind: MediaDeviceKind, deviceId: string): MediaDeviceInfo =>
  ({ deviceId, kind, label: deviceId, groupId: "g" } as MediaDeviceInfo);

/** The deviceId an exact constraint is asking for, or "" for unconstrained. */
function askedFor(c: MediaStreamConstraints, kind: "video" | "audio"): string {
  const v = c[kind];
  if (!v || typeof v === "boolean") return "";
  const id = (v as MediaTrackConstraints).deviceId as { exact?: string } | undefined;
  return id?.exact ?? "";
}

const BASE = { cameraId: "", micId: "", rememberedCameraId: null, rememberedMicId: null };

// ── The failure this exists to fix ───────────────────────────────────────────

describe("openCallMedia, when the camera is held by another application", () => {
  // The regression. A combined getUserMedia fails WHOLE, so the room used to
  // land with an empty MediaStream: no camera, which was the real problem, and
  // no microphone, which was never broken — for the entire call.
  it("still opens the microphone", async () => {
    const g = gatewayFor((c) => {
      if (c.video) return err("NotReadableError");
      return streamOf([reporting(track("audio", "mic-1"))]);
    });

    const out = await openCallMedia({ ...BASE, wantCamera: true, gateway: g.gateway });

    expect(out.micTrack).not.toBeNull();
    expect(out.microphone.deviceId).toBe("mic-1");
    expect(out.cameraTrack).toBeNull();
    expect(out.camera.failure).toBe("in_use");
  });

  it("takes a camera that is free when the chosen one is not", async () => {
    const g = gatewayFor(
      (c) => {
        if (!c.video) return streamOf([reporting(track("audio", "mic-1"))]);
        const want = askedFor(c, "video");
        // The chosen camera is busy; anything else opens.
        if (want === "cam-busy") return err("NotReadableError");
        return streamOf([reporting(track("video", want || "cam-free"))]);
      },
      [device("videoinput", "cam-busy"), device("videoinput", "cam-free"), device("audioinput", "mic-1")],
    );

    const out = await openCallMedia({
      ...BASE,
      wantCamera: true,
      cameraId: "cam-busy",
      gateway: g.gateway,
    });

    expect(out.cameraTrack).not.toBeNull();
    expect(out.camera.fellBack).toBe(true);
    // The FIRST failure is the one reported, not whatever the walk hit later.
    expect(out.camera.failure).toBe("in_use");
    expect(out.micTrack).not.toBeNull();
  });

  // Releasing a camera is asynchronous. The green room stops its preview and
  // the room opens the same camera in the next statement; on Windows that is a
  // race, and one retry is the difference between landing with a camera and
  // landing without one.
  it("tries the same device again after a moment before moving on", async () => {
    // Busy for the combined request AND for the first attempt of the split
    // walk; free by the time the retry lands, which is the shape of a driver
    // that has not finished letting go.
    let videoAttempts = 0;
    const g = gatewayFor((c) => {
      if (!c.video) return streamOf([reporting(track("audio", "mic-1"))]);
      videoAttempts += 1;
      if (videoAttempts <= 2) return err("NotReadableError");
      return streamOf([reporting(track("video", "cam-1"))]);
    });

    const out = await openCallMedia({
      ...BASE,
      wantCamera: true,
      cameraId: "cam-1",
      gateway: g.gateway,
    });

    expect(g.waits).toHaveLength(1);
    expect(out.cameraTrack).not.toBeNull();
    expect(out.camera.deviceId).toBe("cam-1");
    // The same camera came back, so nothing was overridden.
    expect(out.camera.fellBack).toBe(false);
  });
});

describe("openCallMedia, when permission is refused", () => {
  // Walking four cameras behind one refused prompt costs four failures and
  // answers nothing — and on some browsers re-asking is what gets an origin
  // permanently blocked.
  it("asks once per device kind and stops", async () => {
    const g = gatewayFor(
      () => err("NotAllowedError"),
      [device("videoinput", "a"), device("videoinput", "b"), device("audioinput", "m")],
    );

    const out = await openCallMedia({ ...BASE, wantCamera: true, gateway: g.gateway });

    // One combined attempt, then exactly one audio and one video attempt.
    expect(g.calls).toHaveLength(3);
    expect(out.microphone.failure).toBe("denied");
    expect(out.camera.failure).toBe("denied");
    expect(g.waits).toHaveLength(0);
  });
});

describe("openCallMedia, on the ordinary path", () => {
  it("asks for both in one call, so a member sees one permission prompt", async () => {
    const g = gatewayFor(() => streamOf([
      reporting(track("video", "cam-1")),
      reporting(track("audio", "mic-1")),
    ]));

    const out = await openCallMedia({ ...BASE, wantCamera: true, gateway: g.gateway });

    expect(g.calls).toHaveLength(1);
    expect(out.cameraTrack).not.toBeNull();
    expect(out.micTrack).not.toBeNull();
    expect(acquisitionIsClean(out)).toBe(true);
  });

  // The self-aware half: the picker has to show the device that is LIVE, and a
  // request for "default" resolves to a concrete id by design.
  it("reports the device the track actually landed on", async () => {
    const g = gatewayFor(() => streamOf([
      reporting(track("video", "usb-camera-real-id")),
      reporting(track("audio", "headset-real-id")),
    ]));

    const out = await openCallMedia({
      ...BASE,
      wantCamera: true,
      cameraId: "default",
      micId: "default",
      gateway: g.gateway,
    });

    expect(out.camera.deviceId).toBe("usb-camera-real-id");
    expect(out.microphone.deviceId).toBe("headset-real-id");
    // Resolving "default" is not a fallback; saying so would tell nearly every
    // member on Windows their usual camera was unavailable.
    expect(out.camera.fellBack).toBe(false);
    expect(out.microphone.fellBack).toBe(false);
  });

  it("never opens the camera when the member joined with it off", async () => {
    const g = gatewayFor(() => streamOf([reporting(track("audio", "mic-1"))]));

    const out = await openCallMedia({ ...BASE, wantCamera: false, gateway: g.gateway });

    expect(g.calls.every((c) => c.video === false)).toBe(true);
    expect(out.cameraTrack).toBeNull();
    expect(out.cameraWanted).toBe(false);
  });

  // A remembered device that has since been unplugged is the everyday case,
  // and it must not leave someone staring at a black square.
  it("falls through to the system default when the remembered device is gone", async () => {
    const g = gatewayFor((c) => {
      if (!c.video) return streamOf([reporting(track("audio", "mic-1"))]);
      if (askedFor(c, "video") === "unplugged") return err("OverconstrainedError");
      return streamOf([reporting(track("video", "built-in"))]);
    });

    const out = await openCallMedia({
      ...BASE,
      wantCamera: true,
      cameraId: "unplugged",
      gateway: g.gateway,
    });

    expect(out.camera.deviceId).toBe("built-in");
    expect(out.camera.fellBack).toBe(true);
    expect(out.camera.failure).toBe("overconstrained");
  });

  // A success that is missing half of what was asked for. Rare, but a stream
  // held open by nothing keeps the device busy for every other application.
  it("releases a partial stream rather than leaving a device held", async () => {
    const partial = reporting(track("video", "cam-1"));
    const g = gatewayFor((c, n) => {
      if (n === 1) return streamOf([partial]); // video but no audio
      if (!c.video) return streamOf([reporting(track("audio", "mic-1"))]);
      return streamOf([reporting(track("video", "cam-1"))]);
    });

    const out = await openCallMedia({ ...BASE, wantCamera: true, gateway: g.gateway });

    expect(partial.stopped).toBe(true);
    expect(out.micTrack).not.toBeNull();
    expect(out.cameraTrack).not.toBeNull();
  });

  it("survives a browser that will not enumerate devices", async () => {
    const g = gatewayFor((c) => (c.video && c.audio ? err("NotReadableError")
      : c.video ? err("NotFoundError")
      : streamOf([reporting(track("audio", "mic-1"))])));
    g.gateway.enumerateDevices = async () => { throw new Error("nope"); };

    const out = await openCallMedia({ ...BASE, wantCamera: true, gateway: g.gateway });

    expect(out.micTrack).not.toBeNull();
  });
});

function acquisitionIsClean(out: { camera: { failure: unknown; fellBack: boolean }; microphone: { failure: unknown; fellBack: boolean } }): boolean {
  return out.camera.failure === null && out.microphone.failure === null
    && !out.camera.fellBack && !out.microphone.fellBack;
}
