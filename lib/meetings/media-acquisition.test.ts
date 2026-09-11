import {
  MAX_DEVICE_ATTEMPTS,
  acquisitionMessage,
  canRetrySameDevice,
  canTryAnotherDevice,
  classifyMediaError,
  deviceAttemptOrder,
  type AcquisitionOutcome,
  type DeviceOutcome,
} from "./media-acquisition";
import type { Device } from "./devices";

const cam = (id: string): Device => ({ deviceId: id, kind: "videoinput", label: id, groupId: "g" });

const outcome = (over: Partial<DeviceOutcome> = {}): DeviceOutcome => ({
  deviceId: "x",
  fellBack: false,
  failure: null,
  ...over,
});

const acquisition = (over: Partial<AcquisitionOutcome> = {}): AcquisitionOutcome => ({
  camera: outcome(),
  microphone: outcome(),
  cameraWanted: true,
  ...over,
});

describe("classifyMediaError", () => {
  it("maps both the modern and the legacy spellings", () => {
    const err = (name: string) => Object.assign(new Error("x"), { name });
    expect(classifyMediaError(err("NotAllowedError"))).toBe("denied");
    expect(classifyMediaError(err("PermissionDeniedError"))).toBe("denied");
    expect(classifyMediaError(err("NotReadableError"))).toBe("in_use");
    expect(classifyMediaError(err("TrackStartError"))).toBe("in_use");
    expect(classifyMediaError(err("NotFoundError"))).toBe("missing");
    expect(classifyMediaError(err("DevicesNotFoundError"))).toBe("missing");
    expect(classifyMediaError(err("OverconstrainedError"))).toBe("overconstrained");
    expect(classifyMediaError(err("AbortError"))).toBe("aborted");
  });

  it("does not throw on the things that are not Errors", () => {
    expect(classifyMediaError(undefined)).toBe("unknown");
    expect(classifyMediaError(null)).toBe("unknown");
    expect(classifyMediaError({ name: "NotReadableError" })).toBe("unknown");
  });
});

describe("canTryAnotherDevice", () => {
  // The point of the rule: four cameras behind one refused permission prompt
  // is four failures and no information.
  it("is false for a refused permission", () => {
    expect(canTryAnotherDevice("denied")).toBe(false);
  });

  it("is true for everything a different device could fix", () => {
    for (const f of ["in_use", "missing", "overconstrained", "aborted", "unknown"] as const) {
      expect(canTryAnotherDevice(f)).toBe(true);
    }
  });
});

describe("canRetrySameDevice", () => {
  it("retries only the failures that are about timing", () => {
    expect(canRetrySameDevice("in_use")).toBe(true);
    expect(canRetrySameDevice("aborted")).toBe(true);
    expect(canRetrySameDevice("missing")).toBe(false);
    expect(canRetrySameDevice("denied")).toBe(false);
    expect(canRetrySameDevice("overconstrained")).toBe(false);
  });
});

describe("deviceAttemptOrder", () => {
  it("ranks the green room's choice, then the remembered one, then the default", () => {
    expect(deviceAttemptOrder({ requested: "chosen", remembered: "usual", available: [] }))
      .toEqual(["chosen", "usual", ""]);
  });

  it("adds the rest of the hardware after the default", () => {
    expect(deviceAttemptOrder({ requested: "a", remembered: null, available: [cam("a"), cam("b")] }))
      .toEqual(["a", "", "b"]);
  });

  // "" is the system default expressed as "no constraint" — an exact
  // constraint on the id "default" is an OverconstrainedError where the plain
  // request would have worked.
  it("always includes the unconstrained attempt", () => {
    expect(deviceAttemptOrder({ requested: null, remembered: null, available: [] })).toEqual([""]);
  });

  it("never tries the same device twice", () => {
    const order = deviceAttemptOrder({ requested: "a", remembered: "a", available: [cam("a")] });
    expect(order).toEqual(["a", ""]);
  });

  it("ignores the blank ids a browser reports before permission", () => {
    const order = deviceAttemptOrder({ requested: null, remembered: null, available: [cam(""), cam("b")] });
    expect(order).toEqual(["", "b"]);
  });

  // A capture card, a virtual camera and three webcams should not cost ten
  // seconds of failures at the start of a meeting.
  it("stops after a bounded number of attempts", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map(cam);
    const order = deviceAttemptOrder({ requested: "z", remembered: "y", available: many });
    expect(order).toHaveLength(MAX_DEVICE_ATTEMPTS);
    expect(order.slice(0, 3)).toEqual(["z", "y", ""]);
  });
});

describe("acquisitionMessage", () => {
  it("says nothing when both devices opened as asked", () => {
    expect(acquisitionMessage(acquisition())).toBeNull();
  });

  // Inaudible is worse than unseen, so only the microphone is reported when
  // both failed.
  it("speaks about the microphone before the camera", () => {
    const msg = acquisitionMessage(acquisition({
      microphone: outcome({ deviceId: null, failure: "in_use" }),
      camera: outcome({ deviceId: null, failure: "in_use" }),
    }));
    expect(msg).toMatch(/microphone/i);
    expect(msg).not.toMatch(/camera/i);
  });

  it("names the app holding a busy device rather than blaming the browser", () => {
    const msg = acquisitionMessage(acquisition({
      microphone: outcome({ deviceId: null, failure: "in_use" }),
    }));
    expect(msg).toMatch(/another app/i);
  });

  // The message a member reads when their camera will not open has to say the
  // call itself is fine, or a working meeting reads as a broken one.
  it("says the call is still live when only the camera failed", () => {
    const msg = acquisitionMessage(acquisition({
      camera: outcome({ deviceId: null, failure: "in_use" }),
    }));
    expect(msg).toMatch(/audio only/i);
  });

  it("is silent about a camera nobody asked for", () => {
    expect(acquisitionMessage(acquisition({
      cameraWanted: false,
      camera: outcome({ deviceId: null, failure: "missing" }),
    }))).toBeNull();
  });

  it("mentions a successful fallback, because the member did not choose it", () => {
    expect(acquisitionMessage(acquisition({ camera: outcome({ fellBack: true }) })))
      .toMatch(/usual camera/i);
    expect(acquisitionMessage(acquisition({ microphone: outcome({ fellBack: true }) })))
      .toMatch(/usual microphone/i);
    expect(acquisitionMessage(acquisition({
      camera: outcome({ fellBack: true }),
      microphone: outcome({ fellBack: true }),
    }))).toMatch(/camera and microphone/i);
  });
});
