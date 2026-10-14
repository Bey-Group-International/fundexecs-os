import { CAMERA_RELEASE_MS, cameraReleaseDue, msUntilCameraRelease } from "./camera-release";

const due = (over: Partial<Parameters<typeof cameraReleaseDue>[0]> = {}) =>
  cameraReleaseDue({ camOn: false, hasCamera: true, opening: false, offSinceMs: 0, nowMs: CAMERA_RELEASE_MS, ...over });

describe("cameraReleaseDue", () => {
  it("releases a camera that has been off for the whole wait", () => {
    expect(due()).toBe(true);
    expect(due({ nowMs: CAMERA_RELEASE_MS + 60_000 })).toBe(true);
  });

  // The commonest toggle there is — off and straight back on — must never
  // pay for a device reopen.
  it("holds the device through a quick off-and-on", () => {
    expect(due({ nowMs: CAMERA_RELEASE_MS - 1 })).toBe(false);
    expect(due({ nowMs: 500 })).toBe(false);
  });

  it("never releases a camera that is on, or that is not there", () => {
    expect(due({ camOn: true, offSinceMs: null })).toBe(false);
    expect(due({ camOn: true })).toBe(false);
    expect(due({ hasCamera: false })).toBe(false);
  });

  // A release landing on a device that is mid-open would stop the camera the
  // member is about to get.
  it("stands down while a camera is being opened", () => {
    expect(due({ opening: true })).toBe(false);
  });

  it("waits for the remainder of the window", () => {
    expect(msUntilCameraRelease(1_000, 1_000)).toBe(CAMERA_RELEASE_MS);
    expect(msUntilCameraRelease(1_000, 4_000)).toBe(CAMERA_RELEASE_MS - 3_000);
    expect(msUntilCameraRelease(1_000, 1_000 + CAMERA_RELEASE_MS + 5)).toBe(0);
  });

  it("is a wait a person can see the light go out in, and a toggle cannot feel", () => {
    expect(CAMERA_RELEASE_MS).toBeGreaterThanOrEqual(5_000);
    expect(CAMERA_RELEASE_MS).toBeLessThanOrEqual(15_000);
  });
});
