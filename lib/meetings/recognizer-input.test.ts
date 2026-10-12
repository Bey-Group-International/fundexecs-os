import {
  captureConstraints,
  captureDeviceFor,
  captureReusable,
  isEdgeBrand,
  recognizerHearsPickedMic,
  recognizerInputMode,
} from "./recognizer-input";

describe("what to hand the recogniser", () => {
  it("hands every engine but Edge the call's own track, honoured or not", () => {
    expect(recognizerInputMode({ brand: "Google Chrome" })).toBe("track");
    expect(recognizerInputMode({ brand: "Chromium" })).toBe("track");
    expect(recognizerInputMode({ brand: "Safari" })).toBe("track");
    expect(recognizerInputMode({ brand: "" })).toBe("track");
  });

  // Room fcb-xff-yq, 12 October 2026: Edge on the track path, sixty-six runs,
  // four-word nonsense at confidence 1.0, while the Chrome guest kept
  // thirty-word lines in one run.
  it("gives Edge a capture of its own", () => {
    expect(recognizerInputMode({ brand: "Microsoft Edge" })).toBe("capture");
  });

  it("knows Edge by its name alone", () => {
    expect(isEdgeBrand("Microsoft Edge")).toBe(true);
    expect(isEdgeBrand("microsoft edge")).toBe(true);
    expect(isEdgeBrand("Google Chrome")).toBe(false);
    expect(isEdgeBrand("Edgewater")).toBe(false);
    expect(isEdgeBrand(null)).toBe(false);
  });

  it("says which engines end up hearing the picked microphone", () => {
    expect(recognizerHearsPickedMic({ brand: "Google Chrome", available: true })).toBe(true);
    expect(recognizerHearsPickedMic({ brand: "Microsoft Edge", available: true })).toBe(true);
    expect(recognizerHearsPickedMic({ brand: "Microsoft Edge", available: false })).toBe(true);
    expect(recognizerHearsPickedMic({ brand: "Safari", available: false })).toBe(false);
    expect(recognizerHearsPickedMic({ brand: "Google Chrome", available: false })).toBe(false);
  });
});

describe("the recogniser's own capture", () => {
  it("opens the device the call actually settled on, else the pick, else the browser's choice", () => {
    expect(captureDeviceFor("usb-123", "picked-1")).toBe("usb-123");
    expect(captureDeviceFor("", "picked-1")).toBe("picked-1");
    expect(captureDeviceFor(undefined, "default")).toBe("default");
    expect(captureDeviceFor(null, "")).toBeNull();
  });

  it("asks for the device with processing off, exactly like the engine's own capture", () => {
    expect(captureConstraints("usb-123")).toEqual({
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      deviceId: { exact: "usb-123" },
    });
    expect(captureConstraints(null)).toEqual({
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    });
  });

  it("reuses a live capture of the same device and reopens for a switch or an ended track", () => {
    expect(captureReusable({ deviceId: "usb-123", readyState: "live" }, "usb-123")).toBe(true);
    expect(captureReusable({ deviceId: "usb-123", readyState: "live" }, "other")).toBe(false);
    expect(captureReusable({ deviceId: "usb-123", readyState: "ended" }, "usb-123")).toBe(false);
    expect(captureReusable(null, "usb-123")).toBe(false);
    expect(captureReusable({ deviceId: null, readyState: "live" }, null)).toBe(true);
  });
});
